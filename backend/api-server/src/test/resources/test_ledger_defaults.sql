-- Test fixtures only. Rows a test writes straight into the ledger get the loaded file of their
-- business date (created once per date, received long before any test cutoff), and accounts get
-- the next number of their bank, as ledger loading would have given them.
create or replace function public.test_ledger_upload() returns trigger language plpgsql as $$
begin
  if new.upload_id is null then
    select upload_id into new.upload_id from ingest.uploads
      where business_date=new.business_date and status='COMPLETED';
    if new.upload_id is null then
      insert into ingest.uploads(business_date,status,file_name,file_hash,size_bytes,received_at,row_count)
      values(new.business_date,'COMPLETED','ledger_'||new.business_date||'.csv',repeat('0',64),1,
        '2000-01-01T00:00:00Z',0)
      returning upload_id into new.upload_id;
    end if;
  end if;
  return new;
end $$;
drop trigger if exists test_ledger_upload on ledger.transactions;
create trigger test_ledger_upload before insert on ledger.transactions
  for each row execute function public.test_ledger_upload();

create or replace function public.test_account_no() returns trigger language plpgsql as $$
begin
  if new.account_no is null then
    select coalesce(max(account_no),0)+1 into new.account_no from core.accounts where bank_id=new.bank_id;
  end if;
  return new;
end $$;
drop trigger if exists test_account_no on core.accounts;
create trigger test_account_no before insert on core.accounts
  for each row execute function public.test_account_no();
