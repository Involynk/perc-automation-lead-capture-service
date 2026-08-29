import { Controller, Get, Post, Req, Res, Query, HttpException, HttpStatus } from '@nestjs/common';
import { Request, Response } from 'express';
import * as crypto from 'crypto';
import { LeadService } from './lead.service';

const WHATSAPP_VERIFY_TOKEN = process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'perc_webhook_verify_2026';
const IG_VERIFY_TOKEN = process.env.INSTAGRAM_WEBHOOK_VERIFY_TOKEN || 'perc_ig_webhook_verify_2026';
const FB_VERIFY_TOKEN = process.env.FACEBOOK_WEBHOOK_VERIFY_TOKEN || 'perc_fb_webhook_verify_2026';

const processedMessageIds = new Set<string>();

function isDuplicateMessage(msgId: string): boolean {
  if (!msgId) return false;
  if (processedMessageIds.has(msgId)) return true;
  processedMessageIds.add(msgId);
  if (processedMessageIds.size > 5000) {
    const first = processedMessageIds.values().next().value;
    if (first) processedMessageIds.delete(first);
  }
  return false;
}

@Controller()
export class WebhookController {
  constructor(private leadService: LeadService) {}

  @Get('/webhooks/whatsapp')
  verifyWhatsApp(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ): string {
    if (mode === 'subscribe' && token === WHATSAPP_VERIFY_TOKEN && challenge) return challenge;
    throw new HttpException('Verification failed', HttpStatus.FORBIDDEN);
  }

  @Post('/webhooks/whatsapp')
  async processWhatsApp(@Req() req: Request, @Res() res: Response): Promise<void> {
    const data = req.body;

    // 1. Immediately return HTTP 200 OK to Meta so Meta Cloud API never retries (3s timeout)
    res.status(200).json({ status: 'ok' });

    const changes = data?.entry?.[0]?.changes?.[0]?.value || {};
    const messages = changes.messages || [];
    const contacts = changes.contacts || [];
    const metadata = changes.metadata || {};

    for (const msg of messages) {
      const msgId = msg.id || '';

      // 2. Skip duplicate message IDs
      if (msgId && isDuplicateMessage(msgId)) {
        console.log(`⚠️ [WebhookController] Duplicate WhatsApp messageId '${msgId}' skipped.`);
        continue;
      }

      const fromPhone = msg.from || '';
      const msgType = msg.type || 'text';
      const timestamp = msg.timestamp || '';

      const contact = contacts.find((c: any) => c.wa_id === fromPhone);
      const contactName = contact?.profile?.name || '';

      let content = '';
      let contentType = 'text';
      if (msgType === 'text') content = msg.text?.body || '';
      else if (msgType === 'image') { content = msg.image?.link || msg.image?.id || ''; contentType = 'image'; }
      else if (msgType === 'document') { content = msg.document?.link || msg.document?.id || ''; contentType = 'document'; }
      else if (msgType === 'audio') { content = msg.audio?.link || msg.audio?.id || ''; contentType = 'audio'; }
      else if (msgType === 'video') { content = msg.video?.link || msg.video?.id || ''; contentType = 'video'; }
      else if (msgType === 'location') { content = `${msg.location?.latitude || ''},${msg.location?.longitude || ''}`; contentType = 'location'; }
      else if (msgType === 'button') content = msg.button?.text || '';
      else content = JSON.stringify(msg);

      // 3. Process lead capture asynchronously in background
      this.leadService.captureInboundLead({
        source: 'whatsapp',
        source_reference_id: fromPhone,
        first_name: contactName || fromPhone,
        phone: fromPhone,
        message: content,
        content_type: contentType,
        channel_message_id: msgId,
        metadata: { whatsapp_msg_type: msgType, timestamp, phone_number_id: metadata.phone_number_id || '' },
      }).catch((err) => {
        console.error(`❌ [WebhookController] Error capturing inbound WhatsApp lead:`, err);
      });
    }
  }

  @Get('/webhooks/instagram')
  verifyInstagram(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ): string {
    if (mode === 'subscribe' && token === IG_VERIFY_TOKEN && challenge) return challenge;
    throw new HttpException('Verification failed', HttpStatus.FORBIDDEN);
  }

  @Post('/webhooks/instagram')
  async processInstagram(@Req() req: Request): Promise<{ status: string }> {
    const data = req.body;
    const entries = data?.entry || [];

    for (const entry of entries) {
      const changes = entry.changes || [];
      for (const change of changes) {
        if (change.field !== 'messages') continue;
        const value = change.value || {};
        const senderId = value.sender?.id || '';
        const message = value.message || {};
        const text = message.text || '';
        const messageId = message.mid || '';
        const attachments = message.attachments || [];
        const hasMedia = attachments.length > 0;

        await this.leadService.captureInboundLead({
          source: 'instagram',
          source_reference_id: senderId,
          first_name: senderId,
          message: text || '(media message)',
          content_type: hasMedia ? attachments[0].type || 'image' : 'text',
          channel_message_id: messageId,
          metadata: { instagram_sender_id: senderId, timestamp: value.timestamp || '', has_media: hasMedia },
        });
      }
    }

    return { status: 'ok' };
  }

  @Get('/webhooks/facebook')
  verifyFacebook(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ): string {
    if (mode === 'subscribe' && token === FB_VERIFY_TOKEN && challenge) return challenge;
    throw new HttpException('Verification failed', HttpStatus.FORBIDDEN);
  }

  @Post('/webhooks/facebook')
  async processFacebook(@Req() req: Request): Promise<{ status: string }> {
    const data = req.body;
    const entries = data?.entry || [];

    for (const entry of entries) {
      const messaging = entry.messaging || [];
      for (const event of messaging) {
        const senderId = event.sender?.id || '';
        const message = event.message || {};
        const text = message.text || '';
        const messageId = message.mid || '';
        const attachments = message.attachments || [];

        await this.leadService.captureInboundLead({
          source: 'facebook',
          source_reference_id: senderId,
          first_name: senderId,
          message: text || '(media message)',
          content_type: attachments.length > 0 ? attachments[0].type || 'image' : 'text',
          channel_message_id: messageId,
          metadata: { facebook_sender_id: senderId, page_id: process.env.FACEBOOK_PAGE_ID || '', timestamp: String(event.timestamp || '') },
        });
      }
    }

    return { status: 'ok' };
  }

  @Post('/webhooks/email/poll')
  async pollEmail(): Promise<{ status: string; emails_processed: number }> {
    if (!process.env.EMAIL_ADDRESS || !process.env.EMAIL_PASSWORD) {
      return { status: 'skipped', emails_processed: 0 };
    }

    const Imap = require('imap');
    const { simpleParser } = require('mailparser');

    const imap = new Imap({
      user: process.env.EMAIL_ADDRESS,
      password: process.env.EMAIL_PASSWORD,
      host: process.env.EMAIL_IMAP_SERVER || 'imap.gmail.com',
      port: parseInt(process.env.EMAIL_IMAP_PORT || '993'),
      tls: true,
    });

    const leads = await new Promise<any[]>((resolve, reject) => {
      const results: any[] = [];
      function openInbox(cb: any) { imap.openBox('INBOX', true, cb); }

      imap.once('ready', () => {
        openInbox((err: any) => {
          if (err) { reject(err); return; }
          imap.search(['UNSEEN'], (err2: any, uids: number[]) => {
            if (err2 || !uids || uids.length === 0) { imap.end(); resolve([]); return; }

            const fetch = imap.fetch(uids, { bodies: '' });
            fetch.on('message', (msg: any) => {
              msg.on('body', (stream: any) => {
                simpleParser(stream, async (parseErr: any, parsed: any) => {
                  if (parseErr) return;
                  const from = parsed.from?.value?.[0];
                  const emailAddr = from?.address || '';
                  const name = from?.name || emailAddr;
                  const body = parsed.text || parsed.html || '';
                  const cleaned = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 5000);

                  results.push({
                    source: 'email',
                    source_reference_id: emailAddr || String(Math.random()),
                    first_name: name || emailAddr || 'Unknown',
                    phone: null,
                    email: emailAddr,
                    message: cleaned.slice(0, 2000),
                    content_type: 'text',
                    channel_message_id: String(parsed.messageId || Math.random()),
                    metadata: { subject: parsed.subject || '', from: parsed.from?.text || '', email_uid: String(msg) },
                  });
                });
              });
            });
            fetch.once('end', () => { imap.end(); resolve(results); });
          });
        });
      });
      imap.once('error', (e: any) => reject(e));
      imap.connect();
    });

    for (const lead of leads) {
      await this.leadService.captureInboundLead(lead);
    }

    return { status: 'ok', emails_processed: leads.length };
  }
}
