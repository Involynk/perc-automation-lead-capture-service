import { Module, OnModuleInit } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { SupabaseClient } from '@supabase/supabase-js';
import { seedDatabase } from '@perc/shared';
import { SupabaseModule } from './supabase/supabase.module';
import { KafkaModule } from './kafka/kafka.module';
import { WebhookController } from './webhooks/webhook.controller';
import { LeadController } from './webhooks/lead.controller';
import { MessageController } from './webhooks/message.controller';
import { WorkflowController } from './webhooks/workflow.controller';
import { PromiseController } from './webhooks/promise.controller';
import { LeadService } from './webhooks/lead.service';
import { EngineModule } from './webhooks/engine.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    KafkaModule,
    SupabaseModule,
    EngineModule,
  ],
  controllers: [
    WebhookController,
    LeadController,
    MessageController,
    WorkflowController,
    PromiseController,
  ],
  providers: [
    LeadService,
  ],
})
export class LeadCaptureServiceModule implements OnModuleInit {
  constructor(private supabase: SupabaseClient) {}

  async onModuleInit() {
    await seedDatabase(this.supabase);
  }
}
