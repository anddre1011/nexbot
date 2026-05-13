-- Migracion 014 - Modelos ahorradores hibridos
alter table public.flows drop constraint if exists flows_model_check;
alter table public.flows add constraint flows_model_check
  check (model in (
    'gpt-4o', 'gpt-4o-mini', 'gpt-4.1', 'gpt-3.5-turbo',
    'deepseek-v4-pro', 'deepseek-v4-flash',
    'deepseek-chat', 'deepseek-reasoner',
    'hybrid-deepseek-gpt4o', 'hybrid-deepseek-pro-gpt4o'
  ));
