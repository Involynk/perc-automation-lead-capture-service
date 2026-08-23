import { Injectable, Logger } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SupabaseClient } from '@supabase/supabase-js';
import {
  ChannelName,
  TWO_WAY_CHANNELS,
  ResponseEvent,
  TRIGGER_SOURCE_LEAD_CAPTURE,
  TRIGGER_ENQUIRY_RECEIVED,
  TRIGGER_INTENT_GENERAL_INFO,
  DEFAULT_TRIGGER_EVENT,
} from '@perc/shared';
import { WorkflowClient } from './clients';
import * as crypto from 'crypto';

interface RouteIntent {
  triggerEvent?: string;
  courseId?: string;
  branchId?: string;
  counselorId?: string;
  confidence?: number;
  rawUserMessage?: string;
}

@Injectable()
export class RoutingService {
  private readonly logger = new Logger(RoutingService.name);

  constructor(
    private supabase: SupabaseClient,
    private workflowClient: WorkflowClient,
    private eventEmitter: EventEmitter2,
  ) {}

  async routeLead(leadId: string, sourceChannel: string, intent?: RouteIntent): Promise<void> {
    const { data: lead } = await this.supabase
      .from('leads')
      .select('*')
      .eq('id', leadId)
      .single();

    if (!lead) return;

    const event = this.buildResponseEvent(lead, sourceChannel, intent);

    if (lead.phone && lead.phone.startsWith('+')) {
      await this.updateLeadState(lead, 'information_shared', 'information_shared');
      await this.scheduleFollowUp(lead.id, { action: 'check_whatsapp_reply', channel: 'whatsapp', attempt: 1 });
    } else if (TWO_WAY_CHANNELS.includes(sourceChannel)) {
      await this.updateLeadState(lead, 'waiting', 'waiting');
      await this.scheduleFollowUp(lead.id, { action: 'check_whatsapp_reply', channel: sourceChannel, attempt: 1 });
    }

    this.eventEmitter
      .emitAsync('response.triggered', event)
      .catch((err: Error) => this.logger.error(`response.triggered handler failed: ${err.message}`, err.stack));
  }

  private buildResponseEvent(lead: any, sourceChannel: string, intent?: RouteIntent): ResponseEvent {
    const destination: Record<string, string> = {};
    let preferredChannel = sourceChannel;
    let triggerEvent = intent?.triggerEvent || DEFAULT_TRIGGER_EVENT;

    if (lead.phone && lead.phone.startsWith('+')) {
      destination[ChannelName.WHATSAPP] = lead.phone;
      preferredChannel = ChannelName.WHATSAPP;
      if (triggerEvent === DEFAULT_TRIGGER_EVENT) triggerEvent = TRIGGER_INTENT_GENERAL_INFO;
    } else if (TWO_WAY_CHANNELS.includes(sourceChannel)) {
      triggerEvent = TRIGGER_ENQUIRY_RECEIVED;
      destination[sourceChannel] = lead.source_reference_id || '';
    }

    if (lead.email) destination[ChannelName.EMAIL] = lead.email;

    const target = {
      entity_type: 'Lead',
      entity_id: lead.id,
      destination,
      preferred_channel: preferredChannel,
      language_preference: 'en',
    };

    const context = {
      lead_name: lead.first_name,
      raw_user_message: intent?.rawUserMessage || '',
      course_id: intent?.courseId,
      branch_id: intent?.branchId,
      counselor_id: lead.assigned_to || intent?.counselorId,
      nlp_confidence_score: intent?.confidence,
    };

    return new ResponseEvent(
      `evt_${crypto.randomUUID()}`,
      triggerEvent,
      TRIGGER_SOURCE_LEAD_CAPTURE,
      lead.source,
      target,
      context,
    );
  }

  private async updateLeadState(lead: any, leadStatus: string, workflowState: string): Promise<void> {
    await this.supabase
      .from('leads')
      .update({ status: leadStatus, last_contacted_at: new Date().toISOString() })
      .eq('id', lead.id);

    await this.supabase
      .from('workflow_instances')
      .update({ current_state: workflowState })
      .eq('lead_id', lead.id);
  }

  private async scheduleFollowUp(leadId: string, payload: Record<string, unknown>): Promise<void> {
    const scheduledAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();
    const promiseResult = await this.workflowClient.createPromise({
      lead_id: leadId,
      promise_type: 'followup',
      scheduled_at: scheduledAt,
      payload: { ...payload, attempt: 1 },
    });

    if (!promiseResult.success) {
      this.logger.warn(`Failed to schedule follow-up promise for lead ${leadId}: ${promiseResult.error}`);
    }
  }
}
