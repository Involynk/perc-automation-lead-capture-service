import { Controller, Post, Body, HttpException, HttpStatus } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import * as crypto from 'crypto';

@Controller()
export class MessageController {
  constructor(private supabase: SupabaseClient) {}

  @Post('/api/messages')
  async receiveMessage(@Body() body: any) {
    const { data: lead } = await this.supabase.from('leads').select('id').eq('id', body.lead_id).single();
    if (!lead) throw new HttpException('Lead not found', HttpStatus.NOT_FOUND);

    const { data: channelRow } = await this.supabase.from('channels').select('id').eq('name', body.channel || 'website_form').maybeSingle();
    const channelId = channelRow?.id || 'chan_web_form';

    const { data: convs } = await this.supabase
      .from('conversations')
      .select('id')
      .eq('lead_id', body.lead_id)
      .eq('channel_id', channelId)
      .eq('status', 'active')
      .limit(1);

    let convId: string;
    if (!convs || convs.length === 0) {
      convId = crypto.randomUUID();
      await this.supabase.from('conversations').insert({ id: convId, lead_id: body.lead_id, channel_id: channelId });
    } else {
      convId = convs[0].id;
    }

    const msgId = crypto.randomUUID();
    await this.supabase.from('messages').insert({
      id: msgId,
      conversation_id: convId,
      lead_id: body.lead_id,
      direction: 'inbound',
      content_type: body.content_type || 'text',
      content: body.content || '',
      channel_message_id: body.channel_message_id || null,
      metadata: JSON.stringify(body.metadata || {}),
      status: 'sent',
    });

    await this.supabase.from('timeline_events').insert({
      id: crypto.randomUUID(),
      lead_id: body.lead_id,
      event_type_id: 'evt_reply_received',
      actor_type: 'lead',
      description: `Message received: ${(body.content || '').slice(0, 100)}`,
    });

    await this.supabase.from('leads').update({ last_contacted_at: new Date().toISOString() }).eq('id', body.lead_id);

    return { status: 'success', message_id: msgId, conversation_id: convId };
  }
}
