import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { ResponseEvent } from '@perc/shared';
import { CommunicationClient } from '../clients';

@Injectable()
export class ResponseForwarderListener {
  private readonly logger = new Logger(ResponseForwarderListener.name);

  constructor(private communicationClient: CommunicationClient) {}

  @OnEvent('response.triggered')
  async handle(event: ResponseEvent): Promise<void> {
    const result = await this.communicationClient.sendResponse(event);
    this.logger.log(
      `Forwarded ${event.event_id} (${event.trigger_event}) → ${result.success ? 'sent' : `failed: ${result.error}`}`,
    );
  }
}
