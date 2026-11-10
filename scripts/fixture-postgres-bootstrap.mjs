// Public shipped control/source layout only; never load a crypto library or read key/config/data files.
export const fixturePostgresVaultInspection="for f in /usr/share/postgresql/17/extension/supabase_vault.control /usr/share/postgresql/17/extension/pgsodium.control; do printf '\\nPUBLIC_EXTENSION_CONTROL %s\\n' \"$f\"; if test -f \"$f\"; then cat \"$f\"; else printf 'ABSENT\\n'; fi; done; for d in /usr/share/postgresql/17/extension /usr/lib/postgresql; do if test -d \"$d\"; then find \"$d\" -maxdepth 3 -type f \\( -name 'supabase_vault*' -o -name '*pgsodium*' \\) -print; fi; done";
// Public shipped SQL only; never credential/key/data files or an arbitrary path.
export const fixturePostgresMigrationSources="export LC_ALL=C; for f in /docker-entrypoint-initdb.d/init-scripts/00000000000002-storage-schema.sql /docker-entrypoint-initdb.d/init-scripts/00000000000003-post-setup.sql /docker-entrypoint-initdb.d/migrations/*.sql; do printf '\\nPUBLIC_IMAGE_MIGRATION %s\\n' \"$f\"; cat \"$f\"; done";
// Bounded ordered prefix through 20221103090837_revoke_admin.sql, NOT full image/CLI/Auth bootstrap.
// Source: pinned image migrate.sh first heredoc, expanded with an empty fixture password.
// initdb creates supabase_admin; migrate.sh establishes postgres before running init SQL as postgres.
const environment='export PATH=/usr/lib/postgresql/17/bin:/usr/local/bin:/usr/bin:/bin LC_ALL=C PGPASSFILE=/dev/null; unset PGHOST PGPORT PGUSER PGPASSWORD PGSERVICE PGSERVICEFILE PGOPTIONS; ';
const psql='psql -XqwAt --no-password -v ON_ERROR_STOP=1 -h /tmp/owned-postgres -U supabase_admin -d postgres ';
const quote=value=>"'"+value.replaceAll("'","'\\''")+"'";
const vaultPublicSelect="SELECT json_build_object('marker','official-vault-public-prerequisites','sharedir',(SELECT setting FROM pg_config WHERE name='SHAREDIR'),'available',(SELECT json_agg(json_build_object('name',name,'defaultVersion',default_version,'installedVersion',installed_version) ORDER BY name) FROM pg_available_extensions WHERE name IN ('supabase_vault','pgsodium')),'sharedPreload',current_setting('shared_preload_libraries'))";
export const fixturePostgresVaultPrerequisites=environment+psql+'-c '+quote(vaultPublicSelect)+"; for f in /usr/share/postgresql/extension/supabase_vault.control /usr/share/postgresql/extension/pgsodium.control /usr/lib/postgresql/bin/pgsodium_getkey.sh; do printf '\\nPUBLIC_EXTENSION_SOURCE %s\\n' \"$f\"; if test -f \"$f\"; then cat \"$f\"; else printf 'ABSENT\\n'; fi; done; for d in /usr/share/postgresql/extension /usr/lib/postgresql/lib; do if test -d \"$d\"; then find \"$d\" -maxdepth 1 \\( -name 'supabase_vault*' -o -name '*pgsodium*' \\) -print; fi; done";
const bootstrapRole=`do $$
begin
  -- postgres role is pre-created during AMI build
  if not exists (select from pg_roles where rolname = 'postgres') then
    create role postgres superuser login password '';
    alter database postgres owner to postgres;
  end if;
end $$
`;
const fresh="DO $$ BEGIN IF EXISTS(SELECT FROM pg_roles WHERE rolname IN ('postgres','pgbouncer','anon','authenticated','service_role','authenticator','supabase_auth_admin')) OR to_regnamespace('auth') IS NOT NULL THEN RAISE EXCEPTION 'Fresh official bootstrap prefix required'; END IF; END $$";
const initPaths=['00-schema.sql','00000000000000-initial-schema.sql','00000000000001-auth-schema.sql','00000000000002-storage-schema.sql','00000000000003-post-setup.sql'].map(name=>'/docker-entrypoint-initdb.d/init-scripts/'+name);
const initHashes=['494270a846feefa9a9e1462496b1bb707e617341a12344cbe9f3d2e8d8a0aac8','84588fff60ff3cadcd361c820fe502052f4c5fd5aa273740e0690c5ee59ec813','65a4a55ba3248716eb4946a8677be41c94bc90eafaa22c0eb95b09908f96fa4f','1071677a0f0a57e35dc7cb62aeae4fd5417b2e9b7e58be5fd212749dff357f02','f38552008ac577b3e65fbcab784a612b72d079f6695871c84b045a1a921f7096'];
// No gaps/reordering: these are the next official files, ending before vault/crypto migrations.
const migrations=[
['00-extension.sql','a12e0eb4192d188e0dc5058e888ec981c1fd619d5542235d5b692ea0a1d751b2'],
['10000000000000_demote-postgres.sql','581edb76cba2aaf848585be462d07bff7182aa6c638f9365f08dd0c1fb1142ab'],
['20211115181400_update-auth-permissions.sql','bbaa44bc707538e6c67ae8c71a386c41e136cd30fcde563db39c9d0fbde9bdcb'],
['20211118015519_create-realtime-schema.sql','1d6cd4858a0fa50bf910bfd6c11a3436941a5fecdc4bdc02b9b067e8e0b7f566'],
['20211122051245_update-realtime-permissions.sql','9fd431e8f1a3fc0f2e1e427d4f526562c1fe8627e12302974215373885b5254b'],
['20211124212715_update-auth-owner.sql','9698f481ad9cb159df6cefd5cc4b94f4b9db0eda475317aaa057b1e9a54409e0'],
['20211130151719_update-realtime-permissions.sql','6b5d190c93b35a2f804703ed7872946b51fded3272bed0ef9a6585187b0dc2b4'],
['20220118070449_enable-safeupdate-postgrest.sql','2bffffbf1e5a677ef8c8cbba9afc5a66bc77113ee9b2e2b4d2a56629a381cea4'],
['20220126121436_finer-postgrest-triggers.sql','85dc26173d7254490d0c20389bc7e3ac7f7752b872c99bb714167cb01b231312'],
['20220224211803_fix-postgrest-supautils.sql','744ed5c5ae1527c6c73ad4214c11d903eafdc5803eb69183b3b3325b7a65c5bc'],
['20220317095840_pg_graphql.sql','31f5b997cba8d74936203a78613b5bda9b51e339c6c14f80c203440f82e95cf9'],
['20220321174452_fix-postgrest-alter-type-event-trigger.sql','674bfe11a9cb828c55ca7c9e00d4f4edcbcb0003d956d8866c9563810e7f0f0e'],
['20220322085208_gotrue-session-limit.sql','ab2f834addee3115c96edddda927ef9f5d8641c3939d2be82b8ce1e890cf4921'],
['20220404205710_pg_graphql-on-by-default.sql','02ef3e3e6c03032a6ccb828ef1e1b297d9b34ad1947a673756c3c95dd86a01d1'],
['20220609081115_grant-supabase-auth-admin-and-supabase-storage-admin-to-postgres.sql','ff540703d411416925a21553bead344a9cebdec4cb0e53fb93f99973874f1e59'],
['20220613123923_pg_graphql-pg-dump-perms.sql','ab244687d0123859d9d9c6a79b34897e8cdd8f1698bdccd1bef7f7e0ced82334'],
['20220713082019_pg_cron-pg_net-temp-perms-fix.sql','143d6e664f2f508f76964fbaaa018c6ee262464c8c7a881201ae56e025787c94'],
['20221028101028_set_authenticator_timeout.sql','393dd66aee71a99d3956c6c6655e3c010afe9bd3f9a819b03746850ba70f9680'],
['20221103090837_revoke_admin.sql','8fff945cd6f11ab68b2f300c64d43a38ef69d61987aaf596a1d00bfa225234e8']
];
const migrationPaths=migrations.map(([name])=>'/docker-entrypoint-initdb.d/migrations/'+name),paths=[...initPaths,...migrationPaths],hashes=[...initHashes,...migrations.map(([,hash])=>hash)];
const verify="printf '%s\\n' "+hashes.map((hash,index)=>quote(hash+'  '+paths[index])).join(' ')+" 'eb6a57848a73dfbc3b8e40edbadcc7a933f1099ac62cef8c138a18115655b745  /docker-entrypoint-initdb.d/migrate.sh' | sha256sum -c >/dev/null; ";
export const fixturePostgresAuthBaseExpected=Object.freeze({marker:'official-image-pre-auth-grant-boundary',supabaseAdmin:true,postgresSuperuser:false,authOwner:'supabase_admin',authTableOwner:'supabase_auth_admin',apiNoLogin:true,authenticatorNoInherit:true,serviceBypassRls:true,authAdminConfig:['idle_in_transaction_session_timeout=60000','search_path=auth'],anonConfig:['statement_timeout=3s'],authenticatedConfig:['statement_timeout=8s'],authTables:['audit_log_entries','instances','refresh_tokens','schema_migrations','users'],authMigrations:7,users:0,refreshTokens:0,sessionsPresent:false,apiCannotReadUsers:true,authAdminCanWriteUsers:true,authenticatorMemberships:['anon','authenticated','service_role']});
const select=`SELECT json_build_object('marker','official-image-pre-auth-grant-boundary',
'supabaseAdmin',(SELECT rolsuper AND rolcanlogin FROM pg_roles WHERE rolname='supabase_admin'),
'postgresSuperuser',(SELECT rolsuper FROM pg_roles WHERE rolname='postgres'),
'authOwner',(SELECT pg_get_userbyid(nspowner) FROM pg_namespace WHERE nspname='auth'),
'authTableOwner',(SELECT pg_get_userbyid(relowner) FROM pg_class WHERE oid='auth.users'::regclass),
'apiNoLogin',(SELECT count(*)=3 AND bool_and(NOT rolcanlogin AND NOT rolinherit) FROM pg_roles WHERE rolname IN ('anon','authenticated','service_role')),
'authenticatorNoInherit',(SELECT NOT rolinherit AND rolcanlogin FROM pg_roles WHERE rolname='authenticator'),
'serviceBypassRls',(SELECT rolbypassrls FROM pg_roles WHERE rolname='service_role'),
'authAdminConfig',(SELECT array_agg(setting ORDER BY setting) FROM pg_roles,unnest(rolconfig) setting WHERE rolname='supabase_auth_admin'),
'anonConfig',(SELECT rolconfig FROM pg_roles WHERE rolname='anon'),
'authenticatedConfig',(SELECT rolconfig FROM pg_roles WHERE rolname='authenticated'),
'authTables',(SELECT json_agg(tablename ORDER BY tablename) FROM pg_tables WHERE schemaname='auth'),
'authMigrations',(SELECT count(*) FROM auth.schema_migrations),
'users',(SELECT count(*) FROM auth.users),'refreshTokens',(SELECT count(*) FROM auth.refresh_tokens),
'sessionsPresent',to_regclass('auth.sessions') IS NOT NULL,
'apiCannotReadUsers',NOT (has_table_privilege('anon','auth.users','SELECT') OR has_table_privilege('authenticated','auth.users','SELECT') OR has_table_privilege('service_role','auth.users','SELECT')),
'authAdminCanWriteUsers',(has_table_privilege('supabase_auth_admin','auth.users','INSERT') AND has_table_privilege('supabase_auth_admin','auth.users','UPDATE') AND has_table_privilege('supabase_auth_admin','auth.users','DELETE')),
'authenticatorMemberships',(SELECT json_agg(r.rolname ORDER BY r.rolname) FROM pg_auth_members m JOIN pg_roles r ON r.oid=m.roleid JOIN pg_roles u ON u.oid=m.member WHERE u.rolname='authenticator'))`;
export const fixturePostgresAuthBaseRead=environment+'exec '+psql+'-c '+quote(select);
// All hashes/freshness checked before effects; prefix writes run once, never retried.
const postgresPsql=psql.replace('-U supabase_admin','-U postgres');
const authBaseWrites=environment+verify+psql+'-c '+quote(fresh)+' -c '+quote(bootstrapRole)+'; '+initPaths.map(path=>postgresPsql+'-f '+path+'; ').join('')+postgresPsql+'-c '+quote("ALTER USER supabase_admin WITH PASSWORD ''")+'; '+migrationPaths.map(path=>psql+'-f '+path+'; ').join('');
export const fixturePostgresAuthBaseApply=authBaseWrites+'exec '+psql+'-c '+quote(select);
// Separate fresh-only extension; the accepted213 prefix/export above remains unchanged.
const vaultMigration='/docker-entrypoint-initdb.d/migrations/20221207154255_create_pgsodium_and_vault.sql';
const vaultVerify="printf '%s\\n' "+[
 ['cb8877c69b6913153776b865093e85768053daed283dec6835fdac728978d76c',vaultMigration],
 ['dfb755bbdc9db9b49d6084697289aa197de1099b7af649ee610774a5e680215b','supabase_vault.control'],
 ['1603a151c9cf7da411a95c249b3250d921b05da6283cdca4f54e69bedbb5d701','supabase_vault--0.2.8.sql'],
 ['18bf044dbd51bb919a53c8602383051a8407dafce70a8b7c898cac691cc0f0e3','supabase_vault--0.2.8--0.3.0.sql'],
 ['c3739f80d19e1fc18d114705a07ed9fc7c8e3750762abe51f8e9999716fdaff6','supabase_vault--0.3.0.sql'],
 ['c601f01c7d384054536fafd5ebd5d570542360bdcf2f14bfafd4876aaa5d174a','supabase_vault--0.3.0--0.3.1.sql']
].map(([hash,path])=>quote(hash+'  '+(path.startsWith('/')?path:'/usr/share/postgresql/extension/'+path))).join(' ')+" | sha256sum -c >/dev/null; ";
const vaultFresh=`DO $$ BEGIN IF current_setting('shared_preload_libraries')<>'' OR current_setting('session_preload_libraries')<>'' OR current_setting('local_preload_libraries')<>'' OR current_setting('listen_addresses')<>'' OR NOT EXISTS(SELECT FROM pg_available_extensions WHERE name='supabase_vault' AND default_version='0.3.1' AND installed_version IS NULL) OR to_regnamespace('vault') IS NOT NULL OR EXISTS(SELECT FROM pg_extension WHERE extname IN ('supabase_vault','pgsodium')) THEN RAISE EXCEPTION 'Fresh private empty-preload Vault0.3.1 branch required'; END IF; END $$`;
export const fixturePostgresVaultExpected=Object.freeze({marker:'official-image-vault-grant-boundary',authBase:fixturePostgresAuthBaseExpected,version:'0.3.1',schema:'vault',extensionOwner:'supabase_admin',pgsodiumInstalled:false,secrets:0,objects:Object.freeze(['f:_crypto_aead_det_decrypt','f:_crypto_aead_det_encrypt','f:_crypto_aead_det_noncegen','f:create_secret','f:update_secret','r:secrets','v:decrypted_secrets']),objectsOwned:true,viewDefinitionNativeDecrypt:true,postgresGrants:true,serviceGrants:true,apiDenied:true,publicFunctionExecute:false,sharedPreload:'',sessionPreload:'',localPreload:'',listen:'',postgresVersion:170011,initialization:42});
const vaultSelect=`SELECT json_build_object('marker','official-image-vault-grant-boundary','authBase',(${select}),
'version',(SELECT extversion FROM pg_extension WHERE extname='supabase_vault'),
'schema',(SELECT nspname FROM pg_namespace WHERE oid=(SELECT extnamespace FROM pg_extension WHERE extname='supabase_vault')),
'extensionOwner',(SELECT pg_get_userbyid(extowner) FROM pg_extension WHERE extname='supabase_vault'),
'pgsodiumInstalled',EXISTS(SELECT FROM pg_extension WHERE extname='pgsodium'),
'secrets',(SELECT count(*) FROM vault.secrets),
'objects',(SELECT json_agg(item ORDER BY item) FROM (
 SELECT 'f:'||p.proname AS item FROM pg_proc p JOIN pg_depend d ON d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e' JOIN pg_extension e ON d.refclassid='pg_extension'::regclass AND d.refobjid=e.oid WHERE e.extname='supabase_vault'
 UNION ALL SELECT c.relkind||':'||c.relname FROM pg_class c JOIN pg_depend d ON d.classid='pg_class'::regclass AND d.objid=c.oid AND d.deptype='e' JOIN pg_extension e ON d.refclassid='pg_extension'::regclass AND d.refobjid=e.oid WHERE e.extname='supabase_vault' AND c.relkind IN ('r','v')) objects),
'objectsOwned',(SELECT bool_and(pg_get_userbyid(p.proowner)='supabase_admin') FROM pg_proc p WHERE p.pronamespace='vault'::regnamespace) AND (SELECT count(*)=2 AND bool_and(pg_get_userbyid(c.relowner)='supabase_admin') FROM pg_class c WHERE c.relnamespace='vault'::regnamespace AND c.relkind IN ('r','v')) AND (SELECT pg_get_userbyid(nspowner)='supabase_admin' FROM pg_namespace WHERE nspname='vault'),
'viewDefinitionNativeDecrypt',position('_crypto_aead_det_decrypt' in pg_get_viewdef('vault.decrypted_secrets'::regclass,true))>0,
'postgresGrants',has_schema_privilege('postgres','vault','USAGE WITH GRANT OPTION') AND (SELECT bool_and(has_table_privilege('postgres',rel,priv||' WITH GRANT OPTION')) FROM unnest(ARRAY['vault.secrets','vault.decrypted_secrets']) rel CROSS JOIN unnest(ARRAY['SELECT','DELETE','TRUNCATE','REFERENCES']) priv) AND (SELECT count(*)=3 AND bool_and(has_function_privilege('postgres',oid,'EXECUTE WITH GRANT OPTION')) FROM pg_proc WHERE pronamespace='vault'::regnamespace AND proname IN ('create_secret','update_secret','_crypto_aead_det_decrypt')),
'serviceGrants',has_schema_privilege('service_role','vault','USAGE') AND (SELECT bool_and(has_table_privilege('service_role',rel,priv)) FROM unnest(ARRAY['vault.secrets','vault.decrypted_secrets']) rel CROSS JOIN unnest(ARRAY['SELECT','DELETE']) priv) AND (SELECT count(*)=3 AND bool_and(has_function_privilege('service_role',oid,'EXECUTE')) FROM pg_proc WHERE pronamespace='vault'::regnamespace AND proname IN ('create_secret','update_secret','_crypto_aead_det_decrypt')),
'apiDenied',(SELECT bool_and(NOT has_schema_privilege(role,'vault','USAGE') AND NOT has_table_privilege(role,'vault.secrets','SELECT') AND NOT has_table_privilege(role,'vault.decrypted_secrets','SELECT')) FROM unnest(ARRAY['anon','authenticated']) role) AND (SELECT bool_and(NOT has_function_privilege(role,p.oid,'EXECUTE')) FROM pg_proc p CROSS JOIN unnest(ARRAY['anon','authenticated']) role WHERE p.pronamespace='vault'::regnamespace),
'publicFunctionExecute',EXISTS(SELECT FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a WHERE p.pronamespace='vault'::regnamespace AND a.grantee=0 AND a.privilege_type='EXECUTE'),
'sharedPreload',current_setting('shared_preload_libraries'),'sessionPreload',current_setting('session_preload_libraries'),'localPreload',current_setting('local_preload_libraries'),'listen',current_setting('listen_addresses'),'postgresVersion',current_setting('server_version_num')::int,'initialization',(SELECT value FROM public.fixture_initialization WHERE id=1))`;
export const fixturePostgresVaultRead=environment+'exec '+psql+'-c '+quote(vaultSelect);
// All source checks/preconditions precede effects; the shipped migration alone performs CREATE/grants.
export const fixturePostgresVaultApply=environment+vaultVerify+psql+'-c '+quote(vaultFresh)+'; '+authBaseWrites+psql+'-c '+quote(vaultFresh)+' -f '+vaultMigration+'; exec '+psql+'-c '+quote(vaultSelect);
