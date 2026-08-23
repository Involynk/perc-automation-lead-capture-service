import { Controller, Get, Post, Param, Body, Query, HttpException, HttpStatus } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import * as crypto from 'crypto';
import { LeadService } from './lead.service';
import { CategoryService } from './category.service';

@Controller()
export class LeadController {
  constructor(
    private supabase: SupabaseClient,
    private leadService: LeadService,
    private categoryService: CategoryService,
  ) {}

  @Get('/health')
  health(): { status: string } {
    return { status: 'ok' };
  }

  @Get('/api/leads')
  async listLeads(
    @Query('status') status?: string,
    @Query('source') source?: string,
    @Query('limit') limit = 50,
    @Query('offset') offset = 0,
  ) {
    let query = this.supabase.from('leads').select('*', { count: 'exact' }).order('created_at', { ascending: false }).range(offset, offset + limit - 1);

    if (status) query = query.eq('status', status);
    if (source) query = query.eq('source', source);

    const { data: leads, count } = await query;

    return { total: count || 0, leads: leads || [] };
  }

  @Get('/api/leads/:id')
  async getLead(@Param('id') id: string) {
    const { data: lead } = await this.supabase.from('leads').select('*').eq('id', id).single();
    if (!lead) throw new HttpException('Lead not found', HttpStatus.NOT_FOUND);

    const { data: workflow } = await this.supabase.from('workflow_instances').select('*').eq('lead_id', id).maybeSingle();
    const { data: timeline } = await this.supabase.from('timeline_events').select('*').eq('lead_id', id).order('created_at', { ascending: false }).limit(50);
    const { data: conversations } = await this.supabase.from('conversations').select('*').eq('lead_id', id).order('started_at', { ascending: false });

    let conversationsWithMessages: any[] = [];
    if (conversations) {
      conversationsWithMessages = await Promise.all(
        conversations.map(async (c) => {
          const { data: messages } = await this.supabase.from('messages').select('*').eq('conversation_id', c.id).order('sent_at', { ascending: true });
          return { ...c, messages: messages || [] };
        }),
      );
    }

    return { lead, workflow, timeline: timeline || [], conversations: conversationsWithMessages };
  }

  @Post('/api/leads')
  async createLead(@Body() body: any) {
    const leadId = crypto.randomUUID();
    const workflowId = crypto.randomUUID();

    const categories = this.categoryService.detect(body.message);
    const categoryStr = categories.join(',');

    await this.supabase.from('leads').insert({
      id: leadId,
      first_name: (body.first_name || '').slice(0, 100),
      last_name: body.last_name || null,
      phone: body.phone || null,
      email: body.email || null,
      source: body.source,
      source_reference_id: body.source_reference_id || null,
      category: categoryStr,
      status: 'new',
      metadata: JSON.stringify(body.metadata || {}),
    });

    await this.supabase.from('workflow_instances').insert({ id: workflowId, lead_id: leadId, current_state: 'new' });

    await this.supabase.from('timeline_events').insert({
      id: crypto.randomUUID(),
      lead_id: leadId,
      event_type_id: 'evt_lead_created',
      actor_type: 'system',
      description: `Lead created via ${body.source}`,
      metadata: '{}',
    });

    if (body.message) {
      const { data: channelRow } = await this.supabase.from('channels').select('id').eq('name', body.source).maybeSingle();
      const channelId = channelRow?.id || 'chan_web_form';

      const convId = crypto.randomUUID();
      await this.supabase.from('conversations').insert({ id: convId, lead_id: leadId, channel_id: channelId });
      await this.supabase.from('messages').insert({
        id: crypto.randomUUID(),
        conversation_id: convId,
        lead_id: leadId,
        direction: 'inbound',
        content_type: body.content_type || 'text',
        content: body.message,
        status: 'sent',
      });
    }

    const { data: admins } = await this.supabase
      .from('users')
      .select('id')
      .in('role', ['super_admin', 'admin'])
      .eq('is_active', true);

    if (admins) {
      for (const admin of admins) {
        await this.supabase.from('notifications').insert({
          id: crypto.randomUUID(),
          user_id: admin.id,
          lead_id: leadId,
          notification_type: 'new_lead',
          title: `New Lead: ${body.first_name}`,
          message: `${body.first_name} enquired via ${body.source}`,
        });
      }
    }

    return { status: 'success', lead_id: leadId, workflow_id: workflowId, message: 'Lead created successfully' };
  }

  @Post('/api/leads/capture')
  async captureLead(@Body() body: any) {
    const leadId = await this.leadService.captureInboundLead({
      source: body.source,
      source_reference_id: body.source_reference_id,
      first_name: body.first_name,
      phone: body.phone,
      email: body.email,
      message: body.message,
      content_type: body.content_type || 'text',
      channel_message_id: body.channel_message_id,
      category: body.category,
      categories: body.categories,
      metadata: body.metadata,
    });

    return { status: 'success', lead_id: leadId, message: 'Lead captured' };
  }
}
