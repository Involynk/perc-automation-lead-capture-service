import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ResponseEvent } from '@perc/shared';
import axios from 'axios';

export interface SendMessageResult {
  success: boolean;
  channel: string;
  messageId?: string;
  error?: string;
}

@Injectable()
export class CommunicationClient {
  private readonly logger = new Logger(CommunicationClient.name);
  private baseUrl: string;

  constructor(config: ConfigService) {
    this.baseUrl = config.get<string>('COMMUNICATION_SERVICE_URL') || 'http://localhost:3001';
  }

  async send(channel: string, to: string, text: string, leadId?: string): Promise<SendMessageResult> {
    try {
      const { data } = await axios.post<{ success: boolean; messageId?: string }>(
        `${this.baseUrl}/api/messages/send`,
        { channel, to, text, lead_id: leadId },
        { timeout: 15000 },
      );
      return { success: true, channel, messageId: data.messageId };
    } catch (err: any) {
      const error = err.response?.data?.message || err.message || 'Unknown error';
      this.logger.warn(`Communication Service send failed (${channel}): ${error}`);
      return { success: false, channel, error };
    }
  }

  async sendResponse(event: ResponseEvent): Promise<SendMessageResult> {
    try {
      const { data } = await axios.post<{ success: boolean; channel?: string; messageId?: string; error?: string }>(
        `${this.baseUrl}/api/response`,
        event,
        { timeout: 20000 },
      );
      return {
        success: data.success,
        channel: data.channel || event.target.preferred_channel,
        messageId: data.messageId,
        error: data.error,
      };
    } catch (err: any) {
      const error = err.response?.data?.message || err.message || 'Unknown error';
      this.logger.warn(`Response Engine send failed: ${error}`);
      return { success: false, channel: event.target.preferred_channel, error };
    }
  }
}
