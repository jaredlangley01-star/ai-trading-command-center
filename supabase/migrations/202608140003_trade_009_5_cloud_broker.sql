-- TRADE-009.5: allow durable attribution to the cloud-native Alpaca PAPER broker.
alter table automated_decisions drop constraint if exists automated_decisions_execution_source_check;
alter table automated_decisions add constraint automated_decisions_execution_source_check
  check (execution_source in ('NONE','SIMULATED_PAPER','IBKR_PAPER','ALPACA_PAPER'));
alter table automated_executions drop constraint if exists automated_executions_source_check;
alter table automated_executions add constraint automated_executions_source_check
  check (source in ('SIMULATED_PAPER','IBKR_PAPER','ALPACA_PAPER'));
