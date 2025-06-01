create table profiles (
  email text primary key not null,
  encrypted_password text not null,
  is_pro boolean not null default false,
  is_business boolean not null default false,
  max_chatbots int not null default 1,
  active_chatbots int not null default 0,
  subscription_id text not null default ''
);

create table chatbots (
  id serial primary key not null,
  owner_email text not null references profiles(email),
  chatbot_data jsonb not null default '{}'::jsonb,
  messages_left int not null default 100,
  max_entities int not null default 10,
  max_documents int not null default 1,
  max_stored_responses int not null default 10,
  last_reset_at timestamptz not null default now()
);
