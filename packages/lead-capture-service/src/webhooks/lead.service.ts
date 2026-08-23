import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SupabaseClient } from '@supabase/supabase-js';
import { LeadCapturedEvent } from '@perc/shared';
import { CategoryService } from './category.service';
import * as crypto from 'crypto';

@Injectable()
export class LeadService {
  private readonly logger = new Logger(LeadService.name);

  constructor(
    private supabase: SupabaseClient,
    private categoryService: CategoryService,
    private eventEmitter: EventEmitter2,
  ) {}

  async captureInboundLead(params: {
    source: string;
    source_reference_id?: string;
    first_name: string;
    phone?: string;
    email?: string;
    message?: string;
    content_type?: string;
    channel_message_id?: string;
    category?: string;
    categories?: string[];
    metadata?: Record<string, unknown>;
  }): Promise<string> {
    const leadId = crypto.randomUUID();

    let categories = params.categories;
    if (!categories) {
      categories = this.categoryService.detect(params.message);
    }

    const categoryStr = categories.join(',');

    const triggerEvent = this.categoryService.detectTriggerEvent(params.message);
    const confidence = this.categoryService.computeConfidence(params.message, triggerEvent);
    const entities = await this.categoryService.detectEntities(params.message);

    if (params.phone) {
      const { data: existing } = await this.supabase
        .from('leads')
        .select('id')
        .eq('phone', params.phone)
        .eq('is_active', true)
        .maybeSingle();

      if (existing) {
        await this.supabase
          .from('leads')
          .update({ last_contacted_at: new Date().toISOString() })
          .eq('id', existing.id);

        await this.storeMessage(existing.id, params.source, params.message || '', params.content_type || 'text', params.channel_message_id);
        return existing.id;
      }
    }

    const metadata = {
      ...(params.metadata || {}),
      trigger_event: triggerEvent,
      nlp_confidence_score: confidence,
      course_id: entities.course_id || null,
      branch_id: entities.branch_id || null,
    };

    await this.supabase.from('leads').insert({
      id: leadId,
      first_name: params.first_name.slice(0, 100),
      phone: params.phone || null,
      email: params.email || null,
      source: params.source,
      source_reference_id: params.source_reference_id || null,
      category: categoryStr,
      status: 'new',
      metadata: JSON.stringify(metadata),
    });

    if (params.message) {
      await this.storeMessage(leadId, params.source, params.message, params.content_type || 'text', params.channel_message_id);
    }

    await this.supabase
      .from('leads')
      .update({ category: categoryStr })
      .eq('id', leadId);

    this.eventEmitter.emitAsync(
      'lead.captured',
      new LeadCapturedEvent(
        leadId,
        params.source,
        params.first_name,
        params.phone || null,
        params.email || null,
        categories,
        params.message,
        params.metadata,
        triggerEvent,
        entities.course_id,
        entities.branch_id,
        undefined,
        confidence,
      ),
    ).catch((err: Error) => this.logger.error(`lead.captured handler failed: ${err.message}`, err.stack));

    return leadId;
  }

  async storeMessage(leadId: string, channel: string, content: string, contentType: string, channelMessageId?: string): Promise<void> {
    const { data: channelRow } = await this.supabase
      .from('channels')
      .select('id')
      .eq('name', channel)
      .maybeSingle();

    const channelId = channelRow?.id || 'chan_web_form';

    const { data: convs } = await this.supabase
      .from('conversations')
      .select('id')
      .eq('lead_id', leadId)
      .eq('channel_id', channelId)
      .eq('status', 'active')
      .limit(1);

    let convId: string;
    if (!convs || convs.length === 0) {
      convId = crypto.randomUUID();
      await this.supabase.from('conversations').insert({
        id: convId,
        lead_id: leadId,
        channel_id: channelId,
        status: 'active',
      });
    } else {
      convId = convs[0].id;
    }

    const msgData: any = {
      id: crypto.randomUUID(),
      conversation_id: convId,
      lead_id: leadId,
      direction: 'inbound',
      content_type: contentType,
      content,
      status: 'sent',
    };
    if (channelMessageId) msgData.channel_message_id = channelMessageId;

    await this.supabase.from('messages').insert(msgData);

    await this.supabase.from('timeline_events').insert({
      id: crypto.randomUUID(),
      lead_id: leadId,
      event_type_id: 'evt_reply_received',
      actor_type: 'lead',
      description: `Message received via ${channel}: ${content.slice(0, 100)}`,
    });

    await this.supabase
      .from('leads')
      .update({ last_contacted_at: new Date().toISOString() })
      .eq('id', leadId);
  }
}
