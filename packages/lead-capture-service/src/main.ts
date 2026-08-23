import { NestFactory } from '@nestjs/core';
import { LeadCaptureServiceModule } from './lead-capture-service.module';

async function bootstrap() {
  const app = await NestFactory.create(LeadCaptureServiceModule);
  app.enableCors();
  const port = process.env.PORT || 3000;
  await app.listen(port);
  console.log(`🚀 Lead Capture Service running on port ${port}`);
}
bootstrap();
