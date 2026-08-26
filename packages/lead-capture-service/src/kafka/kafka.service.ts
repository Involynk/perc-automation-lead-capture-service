import { Injectable, Logger, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Producer, ProducerRecord, SASLOptions } from 'kafkajs';

@Injectable()
export class KafkaService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(KafkaService.name);
  private kafka: Kafka;
  private producer: Producer;
  private isConnected = false;

  constructor(private readonly configService: ConfigService) {
    const brokersStr = this.configService.get<string>('KAFKA_BROKERS') || 'localhost:9092';
    const brokers = brokersStr.split(',').map((b) => b.trim()).filter(Boolean);
    const clientId = this.configService.get<string>('KAFKA_CLIENT_ID') || 'perc-lead-capture-service';

    const useSsl = this.configService.get<string>('KAFKA_USE_SSL') === 'true';
    const saslMechanism = this.configService.get<string>('KAFKA_SASL_MECHANISM');
    const saslUsername = this.configService.get<string>('KAFKA_SASL_USERNAME');
    const saslPassword = this.configService.get<string>('KAFKA_SASL_PASSWORD');

    let sasl: SASLOptions | undefined;
    if (saslMechanism && saslUsername && saslPassword) {
      sasl = {
        mechanism: saslMechanism.toLowerCase() as any,
        username: saslUsername,
        password: saslPassword,
      };
    }

    this.kafka = new Kafka({
      clientId,
      brokers,
      ssl: useSsl ? true : undefined,
      sasl,
      retry: {
        initialRetryTime: 300,
        retries: 8,
      },
    });

    this.producer = this.kafka.producer({
      allowAutoTopicCreation: true,
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      this.logger.log('Connecting Kafka Producer...');
      await this.producer.connect();
      this.isConnected = true;
      this.logger.log('Kafka Producer connected successfully.');
    } catch (err: any) {
      this.logger.error(`Kafka Producer connection error: ${err.message}`, err.stack);
      this.isConnected = false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.isConnected) {
      try {
        this.logger.log('Disconnecting Kafka Producer...');
        await this.producer.disconnect();
        this.isConnected = false;
        this.logger.log('Kafka Producer disconnected.');
      } catch (err: any) {
        this.logger.error(`Error disconnecting Kafka Producer: ${err.message}`);
      }
    }
  }

  async emitEvent(topic: string, key: string, payload: Record<string, unknown>): Promise<boolean> {
    if (!this.isConnected) {
      // Attempt reconnect if previously failed or disconnected
      try {
        this.logger.warn('Kafka Producer is not connected. Attempting reconnection before emitting...');
        await this.producer.connect();
        this.isConnected = true;
      } catch (reconnectErr: any) {
        this.logger.error(`Kafka reconnect failed while attempting to publish to topic "${topic}": ${reconnectErr.message}`);
        return false;
      }
    }

    try {
      const record: ProducerRecord = {
        topic,
        messages: [
          {
            key,
            value: JSON.stringify(payload),
            timestamp: Date.now().toString(),
          },
        ],
      };

      const result = await this.producer.send(record);
      this.logger.log(
        `Kafka event published → topic: ${topic}, key: ${key}, partition: ${result[0]?.partition ?? 'unknown'}, offset: ${result[0]?.baseOffset ?? 'unknown'}`,
      );
      return true;
    } catch (err: any) {
      this.logger.error(`Failed to publish event to Kafka topic "${topic}": ${err.message}`, err.stack);
      return false;
    }
  }
}
