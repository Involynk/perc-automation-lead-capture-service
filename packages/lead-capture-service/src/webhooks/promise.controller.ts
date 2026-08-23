import { Controller, Get, Post, Put, Param, Body, Query } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { CategoryService } from './category.service';
import * as crypto from 'crypto';

@Controller()
export class PromiseController {
  constructor(
    private supabase: SupabaseClient,
    private categoryService: CategoryService,
  ) {}

  @Get('/api/promises')
  async listPromises(@Query('status') status?: string) {
    let query = this.supabase.from('promises').select('*').order('scheduled_at', { ascending: true }).limit(100);

    if (status) query = query.eq('status', status);

    const { data } = await query;
    return data || [];
  }

  @Post('/api/promises')
  async createPromise(@Body() body: any) {
    const { data: promise } = await this.supabase.from('promises').insert({
      id: crypto.randomUUID(),
      lead_id: body.lead_id,
      promise_type: body.promise_type || 'followup',
      status: 'pending',
      scheduled_at: body.scheduled_at || new Date(Date.now() + 3600000).toISOString(),
      payload: JSON.stringify(body.payload || {}),
      max_retries: body.max_retries || 3,
    }).select('id').single();

    return { status: 'success', promise_id: promise?.id };
  }

  @Put('/api/promises/:id')
  async updatePromise(@Param('id') id: string, @Body() body: any) {
    const update: any = {};
    if (body.status) update.status = body.status;
    if (body.executed_at) update.executed_at = body.executed_at;
    if (body.result) update.result = body.result;
    if (body.error_message) update.error_message = body.error_message;
    if (body.retry_count !== undefined) update.retry_count = body.retry_count;

    await this.supabase.from('promises').update(update).eq('id', id);
    return { status: 'success' };
  }

  @Post('/api/promises/tick')
  async tickScheduler() {
    const now = new Date().toISOString();

    const { data: due } = await this.supabase
      .from('promises')
      .select('*')
      .eq('status', 'pending')
      .lt('scheduled_at', now)
      .limit(50);

    if (!due) return { status: 'ok', promises_processed: 0 };

    for (const p of due) {
      try {
        await this.supabase.from('promises').update({ status: 'executing' }).eq('id', p.id);

        const payload = JSON.parse(p.payload || '{}');

        if (p.promise_type === 'followup') {
          const { data: lead } = await this.supabase.from('leads').select('*').eq('id', p.lead_id).single();
          if (lead) {
            const { data: channelRow } = await this.supabase.from('channels').select('id').eq('name', 'whatsapp').maybeSingle();
            const channelId = channelRow?.id || 'chan_whatsapp';

            const { data: convs } = await this.supabase
              .from('conversations')
              .select('id')
              .eq('lead_id', lead.id)
              .eq('channel_id', channelId)
              .eq('status', 'active')
              .limit(1);

            let convId: string;
            if (!convs || convs.length === 0) {
              convId = crypto.randomUUID();
              await this.supabase.from('conversations').insert({
                id: convId, lead_id: lead.id, channel_id: channelId, status: 'active',
              });
            } else {
              convId = convs[0].id;
            }

            const categories = (lead.category || '').split(',').filter(Boolean);
            const followupText = `Hi ${lead.first_name}! Just following up on your enquiry. Have you had a chance to review the information? Let me know if you have any questions.`;

            await this.supabase.from('messages').insert({
              id: crypto.randomUUID(),
              conversation_id: convId,
              lead_id: lead.id,
              direction: 'outbound',
              content_type: 'text',
              content: followupText,
              status: 'sent',
              sent_at: new Date().toISOString(),
            });

            await this.supabase.from('timeline_events').insert({
              id: crypto.randomUUID(),
              lead_id: lead.id,
              event_type_id: 'evt_followup_sent',
              actor_type: 'automation',
              description: `Follow-up sent to ${lead.first_name}`,
              metadata: JSON.stringify({ promise_id: p.id, action: payload.action || 'followup' }),
            });

            await this.supabase.from('leads').update({ last_contacted_at: new Date().toISOString() }).eq('id', lead.id);
          }
        }

        await this.supabase.from('promises').update({
          status: 'completed',
          executed_at: new Date().toISOString(),
          result: JSON.stringify({ action: payload.action || 'unknown', status: 'done' }),
        }).eq('id', p.id);
      } catch (err: any) {
        await this.supabase.from('promises').update({
          status: 'failed',
          executed_at: new Date().toISOString(),
          error_message: err.message,
        }).eq('id', p.id);
      }
    }

    return { status: 'ok', promises_processed: due.length };
  }

  @Get('/api/promises/pending')
  async getPendingPromises() {
    const { data: promises } = await this.supabase
      .from('promises')
      .select('*')
      .eq('status', 'pending')
      .order('scheduled_at', { ascending: true })
      .limit(100);

    return { promises: promises || [] };
  }
}
