import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';

export interface CreatePromiseResult {
  success: boolean;
  promiseId?: string;
  error?: string;
}

@Injectable()
export class WorkflowClient {
  private readonly logger = new Logger(WorkflowClient.name);
  private baseUrl: string;

  constructor(config: ConfigService) {
    this.baseUrl = config.get<string>('WORKFLOW_SERVICE_URL') || 'http://localhost:3002';
  }

  async createPromise(params: {
    lead_id: string;
    promise_type: string;
    scheduled_at: string;
    payload: Record<string, unknown>;
  }): Promise<CreatePromiseResult> {
    try {
      const { data } = await axios.post<{ status: string; promise_id: string }>(
        `${this.baseUrl}/api/workflow/promises`,
        params,
        { timeout: 10000 },
      );
      return { success: true, promiseId: data.promise_id };
    } catch (err: any) {
      const error = err.response?.data?.message || err.message || 'Unknown error';
      this.logger.warn(`Workflow Service createPromise failed: ${error}`);
      return { success: false, error };
    }
  }
}
