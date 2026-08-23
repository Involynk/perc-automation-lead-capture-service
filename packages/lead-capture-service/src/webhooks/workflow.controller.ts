import { Controller, Get, Put, Param, Body, Query, HttpException, HttpStatus } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import * as crypto from 'crypto';

@Controller()
export class WorkflowController {
  constructor(private supabase: SupabaseClient) {}

  @Get('/api/workflows')
  async listWorkflows(@Query('state') state?: string) {
    let query = this.supabase.from('workflow_instances').select('*').order('created_at', { ascending: false }).limit(100);

    if (state) query = query.eq('current_state', state);

    const { data } = await query;
    return data || [];
  }

  @Get('/api/workflows/:id')
  async getWorkflow(@Param('id') id: string) {
    const { data: wf } = await this.supabase.from('workflow_instances').select('*').eq('id', id).single();
    if (!wf) throw new HttpException('Workflow not found', HttpStatus.NOT_FOUND);

    const { data: history } = await this.supabase.from('workflow_history').select('*').eq('workflow_id', id).order('created_at', { ascending: false });

    return { workflow: wf, history: history || [] };
  }

  @Put('/api/workflows/:id/state')
  async updateWorkflowState(@Param('id') id: string, @Body() body: any) {
    const { data: wf } = await this.supabase.from('workflow_instances').select('*').eq('id', id).single();
    if (!wf) throw new HttpException('Workflow not found', HttpStatus.NOT_FOUND);

    const fromState = wf.current_state;
    const toState = body.state;

    await this.supabase.from('workflow_instances').update({ current_state: toState, previous_state: fromState }).eq('id', id);
    await this.supabase.from('workflow_history').insert({
      id: crypto.randomUUID(),
      workflow_id: id,
      lead_id: wf.lead_id,
      from_state: fromState,
      to_state: toState,
      triggered_by: body.triggered_by || 'system',
      metadata: JSON.stringify(body.metadata || {}),
    });

    return { status: 'success', from_state: fromState, to_state: toState };
  }

  @Get('/api/workflows/lead/:leadId')
  async getWorkflowByLead(@Param('leadId') leadId: string) {
    const { data: wf } = await this.supabase.from('workflow_instances').select('*').eq('lead_id', leadId).single();
    if (!wf) throw new HttpException('Workflow not found', HttpStatus.NOT_FOUND);

    const { data: history } = await this.supabase.from('workflow_history').select('*').eq('workflow_id', wf.id).order('created_at', { ascending: false });

    return { workflow: wf, history: history || [] };
  }
}
