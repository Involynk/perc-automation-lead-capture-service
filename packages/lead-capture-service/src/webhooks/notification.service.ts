import { Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import * as crypto from 'crypto';

@Injectable()
export class NotificationService {
  constructor(private supabase: SupabaseClient) {}

  async notifyAdmins(leadId: string, firstName: string, source: string): Promise<void> {
    const { data: admins } = await this.supabase
      .from('users')
      .select('id')
      .in('role', ['super_admin', 'admin'])
      .eq('is_active', true);

    if (!admins) return;

    for (const admin of admins) {
      await this.supabase.from('notifications').insert({
        id: crypto.randomUUID(),
        user_id: admin.id,
        lead_id: leadId,
        notification_type: 'new_lead',
        title: `New Lead: ${firstName}`,
        message: `${firstName} enquired via ${source}`,
      });
    }
  }
}
