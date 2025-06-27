create table profiles (
  email text primary key not null,
  encrypted_password text not null,
  active_chatbots int not null default 0,
);

create table chatbots (
  id serial primary key not null,
  owner_email text not null references profiles(email),
  chatbot_data jsonb not null default '{}'::jsonb,
);
