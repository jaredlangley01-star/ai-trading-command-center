-- TRADE-003: private owner authentication, defaults and ownership policies.
-- Run after the TRADE-001 foundation migration.

create or replace function public.handle_new_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', split_part(new.email, '@', 1)))
  on conflict (id) do nothing;
  insert into public.risk_settings (user_id, settings)
  values (new.id, '{"autoTraderEnabled":true,"autoTraderAllocatedCapital":25000,"maximumCapitalPerTrade":2500,"maximumRiskPerTrade":250,"dailyMaximumLoss":750,"dailyProfitTarget":1000,"maximumTradesPerDay":8,"maximumConcurrentPositions":4,"maximumPortfolioDrawdown":12,"maximumExposurePerAsset":20,"bigMoneyApprovalThreshold":85}'::jsonb)
  on conflict (user_id) do nothing;
  insert into public.system_state (user_id, mode, auto_trader_status, risk_state, emergency_stop_active)
  values (new.id, 'PAPER', 'PAUSED', 'NORMAL', false)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users
for each row execute procedure public.handle_new_owner();

-- Profiles expose only the authenticated owner's row.
create policy "owner_select_profile" on profiles for select using (auth.uid() = id);
create policy "owner_update_profile" on profiles for update using (auth.uid() = id) with check (auth.uid() = id);
create policy "owner_insert_profile" on profiles for insert with check (auth.uid() = id);

-- Every remaining table is owner scoped through user_id.
create policy "owner_all_broker_accounts" on broker_accounts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner_all_risk_settings" on risk_settings for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner_all_strategies" on strategies for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner_all_recommendations" on recommendations for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner_all_orders" on orders for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner_all_positions" on positions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner_all_trades" on trades for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner_all_journal_entries" on journal_entries for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner_all_backtests" on backtests for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner_all_notifications" on notifications for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "owner_all_system_state" on system_state for all using (auth.uid() = user_id) with check (auth.uid() = user_id and mode = 'PAPER');
create policy "owner_select_audit_events" on audit_events for select using (auth.uid() = user_id);
create policy "owner_insert_audit_events" on audit_events for insert with check (auth.uid() = user_id);

-- The authenticated client never receives direct access to auth schema or any
-- service-role credential. LIVE values remain rejected by database checks.
