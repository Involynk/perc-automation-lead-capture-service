import { Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import {
  CATEGORY_KEYWORDS,
  ORDERED_CATEGORIES,
  DEFAULT_TRIGGER_EVENT,
  ORDERED_TRIGGER_EVENTS,
  TRIGGER_HANDOVER_COMPLAINT,
  TRIGGER_HANDOVER_REQUESTED,
  TRIGGER_KEYWORDS,
} from '@perc/shared';

@Injectable()
export class CategoryService {
  constructor(private supabase: SupabaseClient) {}

  detect(text: string | null | undefined): string[] {
    if (!text) return ['general_enquiry'];

    const lower = text.toLowerCase();
    const matched: string[] = [];

    for (const cat of ORDERED_CATEGORIES) {
      const keywords = CATEGORY_KEYWORDS[cat];
      if (keywords.some((kw) => lower.includes(kw))) {
        matched.push(cat);
      }
    }

    return matched.length > 0 ? matched : ['general_enquiry'];
  }

  detectTriggerEvent(text: string | null | undefined): string {
    if (!text) return DEFAULT_TRIGGER_EVENT;

    const lower = text.toLowerCase();

    if (/(talk to a human|talk to human|speak to counselor|speak to a counselor|call me|contact counselor|human agent|real person)/.test(lower)) {
      return TRIGGER_HANDOVER_REQUESTED;
    }
    if (/(frustrated|angry|complaint|worst|terrible|unhelpful|refund my money)/.test(lower)) {
      return TRIGGER_HANDOVER_COMPLAINT;
    }

    for (const evt of ORDERED_TRIGGER_EVENTS) {
      const keywords = TRIGGER_KEYWORDS[evt];
      if (keywords && keywords.some((kw) => lower.includes(kw))) {
        return evt;
      }
    }

    return DEFAULT_TRIGGER_EVENT;
  }

  computeConfidence(text: string | null | undefined, triggerEvent: string): number {
    if (!text) return 0.3;

    if (triggerEvent === DEFAULT_TRIGGER_EVENT) return 0.35;

    const lower = text.toLowerCase();
    const keywords = TRIGGER_KEYWORDS[triggerEvent] || [];
    const hits = keywords.filter((kw) => lower.includes(kw)).length;

    if (hits <= 0) return 0.4;
    return Math.min(0.98, 0.55 + hits * 0.12);
  }

  async detectEntities(
    text: string | null | undefined,
  ): Promise<{ course_id?: string; branch_id?: string }> {
    if (!text) return {};

    const lower = text.toLowerCase();
    const entities: { course_id?: string; branch_id?: string } = {};

    const { data: courses } = await this.supabase
      .from('courses')
      .select('id, name')
      .eq('is_active', true);

    if (courses) {
      for (const c of courses) {
        const tokens = c.name.toLowerCase().split(' ').filter((t: string) => t.length > 1);
        if (tokens.some((t: string) => lower.includes(t))) {
          entities.course_id = c.id;
          break;
        }
      }
    }

    const { data: branches } = await this.supabase
      .from('branches')
      .select('id, name')
      .eq('is_active', true);

    if (branches) {
      for (const b of branches) {
        const tokens = b.name.toLowerCase().split(' ').filter((t: string) => t.length > 2);
        if (tokens.some((t: string) => lower.includes(t))) {
          entities.branch_id = b.id;
          break;
        }
      }
    }

    return entities;
  }
}
