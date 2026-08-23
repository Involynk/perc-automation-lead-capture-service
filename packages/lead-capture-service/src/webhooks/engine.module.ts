import { Module } from '@nestjs/common';
import { CategoryService } from './category.service';
import { RoutingService } from './routing.service';
import { NotificationService } from './notification.service';
import { CommunicationClient, WorkflowClient } from './clients';
import { LeadCapturedListener } from './listeners/lead-captured.listener';
import { ResponseForwarderListener } from './listeners/response-forwarder.listener';

@Module({
  providers: [
    CategoryService, RoutingService, NotificationService,
    CommunicationClient, WorkflowClient,
    LeadCapturedListener,
    ResponseForwarderListener,
  ],
  exports: [CategoryService, RoutingService, NotificationService],
})
export class EngineModule {}
