import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseClient } from '@supabase/supabase-js';
import { KafkaService } from '../kafka/kafka.service';
import { CategoryService } from './category.service';
import * as crypto from 'crypto';

@Injectable()
export class LeadService {
  private readonly logger = new Logger(LeadService.name);
  private readonly kafkaTopic: string;

  constructor(
    private readonly supabase: SupabaseClient,
    private readonly categoryService: CategoryService,
    private readonly kafkaService: KafkaService,
    private readonly configService: ConfigService,
  ) {
    this.kafkaTopic = this.configService.get<string>('KAFKA_TOPIC_LEAD_CAPTURED') || 'perc.lead-events';
  }

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
    let leadId: string;
    let isNewLead = true;

    let categories = params.categories;
    if (!categories) {
      categories = this.categoryService.detect(params.message);
    }
    const categoryStr = categories.join(',');

    const triggerEvent = this.categoryService.detectTriggerEvent(params.message);
    const confidence = this.categoryService.computeConfidence(params.message, triggerEvent);
    const entities = await this.categoryService.detectEntities(params.message);

    // 1. Deduplication check by phone
    if (params.phone) {
      const { data: existing } = await this.supabase
        .from('leads')
        .select('id')
        .eq('phone', params.phone)
        .eq('is_active', true)
        .maybeSingle();

      if (existing) {
        leadId = existing.id;
        isNewLead = false;

        await this.supabase
          .from('leads')
          .update({ last_contacted_at: new Date().toISOString() })
          .eq('id', existing.id);
      } else {
        leadId = crypto.randomUUID();
      }
    } else {
      leadId = crypto.randomUUID();
    }

    // 2. If new lead, persist lead and initial workflow
    if (isNewLead) {
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

      await this.supabase.from('workflow_instances').insert({
        id: crypto.randomUUID(),
        lead_id: leadId,
        current_state: 'new',
      });

      await this.supabase.from('timeline_events').insert({
        id: crypto.randomUUID(),
        lead_id: leadId,
        event_type_id: 'evt_lead_created',
        actor_type: 'system',
        description: `Lead created via ${params.source}`,
        metadata: JSON.stringify(params.metadata || {}),
      });
    }

    // 3. Store inbound message
    if (params.message) {
      await this.storeMessage(leadId, params.source, params.message, params.content_type || 'text', params.channel_message_id);
    }

    // 4. Retrieve ordered conversation history for the lead
    const conversationHistory = await this.getConversationHistory(leadId);

    // 5. Produce lead.captured event to Kafka topic 'perc.lead-events'
    const eventId = `evt_${crypto.randomUUID()}`;
    const kafkaPayload = {
      eventId,
      leadId,
      isNewLead,
      channel: params.source,
      sourceReferenceId: params.source_reference_id || '',
      conversationHistory,
      capturedAt: new Date().toISOString(),
      metadata: {
        trigger_event: triggerEvent,
        categories,
        confidence,
        course_id: entities.course_id || null,
        branch_id: entities.branch_id || null,
        ...(params.metadata || {}),
      },
    };

    await this.kafkaService.emitEvent(this.kafkaTopic, leadId, kafkaPayload);

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

  private async getConversationHistory(leadId: string): Promise<Array<{
    id: string;
    direction: string;
    content_type: string;
    content: any;
    sent_at: string;
  }>> {
    const { data: messages } = await this.supabase
      .from('messages')
      .select('id, direction, content_type, content, sent_at')
      .eq('lead_id', leadId)
      .order('sent_at', { ascending: true });

    return (messages || []).map((m) => ({
      id: m.id,
      direction: m.direction,
      content_type: m.content_type,
      content: m.content,
      sent_at: m.sent_at,
    }));
  }
}
