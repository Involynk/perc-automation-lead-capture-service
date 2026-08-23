import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SupabaseClient } from '@supabase/supabase-js';
import { LeadCapturedEvent } from '@perc/shared';
import { RoutingService } from '../routing.service';
import { NotificationService } from '../notification.service';
import * as crypto from 'crypto';

@Injectable()
export class LeadCapturedListener {
  constructor(
    private supabase: SupabaseClient,
    private routingService: RoutingService,
    private notificationService: NotificationService,
  ) {}

  @OnEvent('lead.captured')
  async handle(event: LeadCapturedEvent): Promise<void> {
    await this.supabase.from('workflow_instances').insert({
      id: crypto.randomUUID(),
      lead_id: event.leadId,
      current_state: 'new',
    });

    await this.supabase.from('timeline_events').insert({
      id: crypto.randomUUID(),
      lead_id: event.leadId,
      event_type_id: 'evt_lead_created',
      actor_type: 'automation',
      description: `Lead captured via ${event.source}`,
      metadata: JSON.stringify(event.metadata || {}),
    });

    await this.notificationService.notifyAdmins(event.leadId, event.firstName, event.source);

    await this.routingService.routeLead(event.leadId, event.source, {
      triggerEvent: event.triggerEvent,
      courseId: event.courseId,
      branchId: event.branchId,
      counselorId: event.counselorId,
      confidence: event.confidence,
      rawUserMessage: event.message,
    });
  }
}
