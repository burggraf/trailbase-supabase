import { plainObject, unsupported, uuidToNative, uuidFromNative, normalizeError } from './common.js';
import { createAuth, type AuthOptions } from './auth.js';
export type { AuthOptions, AuthStorage, AuthUser, AuthSession, AuthError, AuthResponse, PasswordCredentials, AuthChangeEvent } from './auth.js';
import { initClient, type Client as NativeClient, type Filter } from 'trailbase';

export type FieldType = 'uuid' | 'boolean' | 'integer' | 'text';
export type FieldMapping = { type: FieldType; nullable?: boolean };
export type TableMapping = { api: string; primaryKey: string; fields: Record<string, FieldMapping>; readOnly?: boolean };
export type TrailBaseMapping = { tables: Record<string, TableMapping> };
export type ClientOptions = {
  auth?: AuthOptions;
  db?: { schema?: 'public' };
  global?: { fetch?: typeof fetch };
  trailbase: TrailBaseMapping;
};
export type QueryError = { name: string; message: string; status?: number; code?: string; details?: string; hint?: string };
export type QueryResult<T> = { data: T | null; error: QueryError | null };

type TablesOf<Database> = Database extends { public: { Tables: infer Tables } } ? Tables : Record<string, unknown>;
type ViewsOf<Database> = Database extends { public: { Views: infer Views } } ? Views : {};
type RelationsOf<Database> = TablesOf<Database> & ViewsOf<Database>;
type RelationNames<Database> = Extract<keyof RelationsOf<Database>, string>;
type ShapeOf<Database, Name extends string, Shape extends 'Row' | 'Insert' | 'Update'> =
  Name extends keyof RelationsOf<Database> ? RelationsOf<Database>[Name] extends { [Key in Shape]: infer Value } ? Value : Record<string, unknown> : Record<string, unknown>;
type Column<Row> = Extract<keyof Row, string>;
type FilterValue<Row, Key extends Column<Row>> = Exclude<Row[Key], null | undefined>;


function mappedField(mapping: TableMapping, column: string): FieldMapping | undefined {
  return typeof column === 'string' && Object.hasOwn(mapping.fields, column) ? mapping.fields[column] : undefined;
}


const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/;


function validateMapping(mapping: TrailBaseMapping): void {
  plainObject(mapping, 'trailbase');
  for (const key of Object.keys(mapping)) if (key !== 'tables') unsupported(`Unsupported mapping option: ${key}`);
  plainObject(mapping.tables, 'trailbase.tables');
  if (!Object.keys(mapping.tables).length) throw new TypeError('trailbase.tables must define at least one table mapping');
  for (const [name, table] of Object.entries(mapping.tables)) {
    plainObject(table, `Mapping ${name}`);
    for (const key of Object.keys(table)) if (!['api', 'primaryKey', 'fields', 'readOnly'].includes(key)) unsupported(`Unsupported table mapping option: ${key}`);
    if (!IDENTIFIER.test(name) || typeof table.api !== 'string' || !IDENTIFIER.test(table.api) || typeof table.primaryKey !== 'string' || !IDENTIFIER.test(table.primaryKey)) throw new TypeError('Invalid table mapping identifier');
    if (table.readOnly !== undefined && typeof table.readOnly !== 'boolean') throw new TypeError('readOnly must be boolean');
    plainObject(table.fields, `Fields ${name}`);
    if (!Object.hasOwn(table.fields, table.primaryKey)) throw new TypeError(`Missing primary-key mapping for ${name}`);
    for (const [column, field] of Object.entries(table.fields)) {
      plainObject(field, `Field ${name}.${column}`);
      for (const key of Object.keys(field)) if (!['type', 'nullable'].includes(key)) unsupported(`Unsupported field mapping option: ${key}`);
      if (!IDENTIFIER.test(column) || typeof field.type !== 'string' || !['uuid', 'boolean', 'integer', 'text'].includes(field.type) || (field.nullable !== undefined && typeof field.nullable !== 'boolean')) {
        throw new TypeError(`Invalid field mapping: ${name}.${column}`);
      }
    }
  }
}


function fieldToNative(field: FieldMapping, value: unknown): unknown {
  if (value === null) {
    if (field.nullable) return null;
    throw new TypeError('Null is not allowed for this field');
  }
  switch (field.type) {
    case 'uuid': return uuidToNative(value);
    case 'boolean':
      if (typeof value !== 'boolean') throw new TypeError('Expected boolean');
      return value ? 1 : 0;
    case 'integer':
      if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TypeError('Expected safe integer');
      return value;
    case 'text':
      if (typeof value !== 'string') throw new TypeError('Expected text');
      return value;
    default: throw new TypeError('Unsupported field codec');
  }
}

function fieldFromNative(field: FieldMapping, value: unknown): unknown {
  if (value === null) {
    if (field.nullable) return null;
    throw new TypeError('Native response contains null for a non-null field');
  }
  switch (field.type) {
    case 'uuid': return uuidFromNative(value);
    case 'boolean':
      if (value !== 0 && value !== 1) throw new TypeError('Native response contains invalid boolean');
      return value === 1;
    case 'integer':
      if (typeof value !== 'number' || !Number.isSafeInteger(value)) throw new TypeError('Native response contains unsafe integer');
      return value;
    case 'text':
      if (typeof value !== 'string') throw new TypeError('Native response contains invalid text');
      return value;
    default: throw new TypeError('Unsupported field codec');
  }
}

function validateCreateId(field: FieldMapping, value: unknown): void {
  // The pinned server returns Vec<String>; the native client returns ids[0] unchanged.
  if (field.type === 'integer') {
    if (typeof value !== 'string' || !/^(?:0|-?[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value)) || String(Number(value)) !== value) {
      throw new TypeError('Invalid native create acknowledgement: expected a safe-integer decimal string');
    }
    return;
  }
  if (field.type === 'uuid') {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{22}==$/.test(value) || uuidToNative(uuidFromNative(value)) !== value) {
      throw new TypeError('Invalid native create acknowledgement: expected a padded native UUIDv4');
    }
    return;
  }
  throw new TypeError('Unsupported create acknowledgement codec');
}

function mapRow<Row>(mapping: TableMapping, input: unknown): Row {
  plainObject(input, 'TrailBase record');
  const output: Record<string, unknown> = Object.create(null);
  for (const column of Object.keys(mapping.fields)) {
    if (!Object.hasOwn(input, column)) throw new TypeError(`TrailBase returned missing mapped field: ${column}`);
  }
  for (const [column, value] of Object.entries(input)) {
    const field = mappedField(mapping, column);
    if (!field) throw new TypeError(`TrailBase returned unmapped field: ${column}`);
    output[column] = fieldFromNative(field, value);
  }
  return output as Row;
}


class SelectQuery<Row, Data = Row[]> implements PromiseLike<QueryResult<Data>> {
  private cardinality: 'many' | 'single' | 'maybeSingle' = 'many';
  private readonly native: NativeClient;
  private readonly mapping: TableMapping;
  private readonly filters: Filter[] = [];
  private readonly ordering: string[] = [];
  private pageLimit = 1000;
  private offset = 0;

  constructor(native: NativeClient, mapping: TableMapping) {
    this.native = native;
    this.mapping = mapping;
  }

  eq<Key extends Column<Row>>(column: Key, value: FilterValue<Row, Key>): this { return this.addFilter('equal', column, value, arguments.length); }
  neq<Key extends Column<Row>>(column: Key, value: FilterValue<Row, Key>): this { return this.addFilter('notEqual', column, value, arguments.length); }
  gt<Key extends Column<Row>>(column: Key, value: FilterValue<Row, Key>): this { return this.addFilter('greaterThan', column, value, arguments.length); }
  gte<Key extends Column<Row>>(column: Key, value: FilterValue<Row, Key>): this { return this.addFilter('greaterThanEqual', column, value, arguments.length); }
  lt<Key extends Column<Row>>(column: Key, value: FilterValue<Row, Key>): this { return this.addFilter('lessThan', column, value, arguments.length); }
  lte<Key extends Column<Row>>(column: Key, value: FilterValue<Row, Key>): this { return this.addFilter('lessThanEqual', column, value, arguments.length); }

  order(column: Column<Row>, options: { ascending?: boolean } = {}): this {
    const field = mappedField(this.mapping, column);
    if (!field) throw new TypeError(`Unmapped order field: ${column}`);
    if (field.nullable) unsupported('Nullable ordering is not supported');
    plainObject(options, 'Order options');
    if (arguments.length > 2) unsupported('Unsupported order arguments');
    for (const key of Object.keys(options)) if (key !== 'ascending') unsupported(`Unsupported order option: ${key}`);
    if (options.ascending !== undefined && typeof options.ascending !== 'boolean') throw new TypeError('ascending must be boolean');
    this.ordering.push(`${options.ascending === false ? '-' : '+'}${column}`);
    return this;
  }

  limit(value: number): this {
    if (arguments.length > 1) unsupported('Unsupported limit options');
    if (!Number.isSafeInteger(value) || value < 0 || value > 1000) throw new TypeError('limit must be a safe integer from 0 to 1000');
    this.pageLimit = value;
    return this;
  }

  range(from: number, to: number): this {
    if (arguments.length > 2) unsupported('Unsupported range options');
    if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || from < 0 || to < from) throw new TypeError('range requires ordered nonnegative safe integers');
    const width = to - from + 1;
    if (!Number.isSafeInteger(width) || width > 1000) throw new TypeError('range width must be from 1 to 1000');
    this.offset = from;
    this.pageLimit = width;
    return this;
  }

  private addFilter(op: NonNullable<Filter['op']>, column: string, value: unknown, arity: number): this {
    if (arity !== 2) unsupported('Unsupported filter arguments');
    const field = mappedField(this.mapping, column);
    if (!field) throw new TypeError(`Unmapped filter field: ${column}`);
    if (value === null) unsupported('Null filters are not supported');
    this.filters.push({ column, op, value: String(fieldToNative(field, value)) });
    return this;
  }

  single(): SelectQuery<Row, Row> {
    if (arguments.length) unsupported('Unsupported single options');
    this.cardinality = 'single';
    return this as unknown as SelectQuery<Row, Row>;
  }

  maybeSingle(): SelectQuery<Row, Row | null> {
    if (arguments.length) unsupported('Unsupported maybeSingle options');
    this.cardinality = 'maybeSingle';
    return this as unknown as SelectQuery<Row, Row | null>;
  }

  then<TResult1 = QueryResult<Data>, TResult2 = never>(
    onfulfilled?: ((value: QueryResult<Data>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    return this.execute().then(onfulfilled, onrejected);
  }

  private async execute(): Promise<QueryResult<Data>> {
    try {
      if (this.pageLimit === 0 && this.offset > 0) throw new RangeError('Adapter range error: positive offset with zero limit is not supported');
      let response: unknown;
      if (this.pageLimit === 0) {
        // The pinned list client omits zero. Use native HTTP without bypassing access rules.
        const params = new URLSearchParams({ limit: '0' });
        const operators = { equal: '$eq', notEqual: '$ne', greaterThan: '$gt', greaterThanEqual: '$gte', lessThan: '$lt', lessThanEqual: '$lte' };
        for (const filter of this.filters) {
          const operator = operators[filter.op as keyof typeof operators];
          params.append(`filter[${filter.column}][${operator}]`, filter.value);
        }
        if (this.ordering.length) params.set('order', this.ordering.join(','));
        response = await (await this.native.fetch(`/api/records/v1/${this.mapping.api}?${params}`)).json();
      } else {
        response = await this.native.records(this.mapping.api).list({ filters: this.filters, order: this.ordering.length ? this.ordering : undefined, pagination: { limit: this.pageLimit, offset: this.offset } });
      }
      if (!response || typeof response !== 'object') throw new TypeError('TrailBase returned an invalid list');
      const records: unknown = Reflect.get(response, 'records');
      if (!Array.isArray(records)) throw new TypeError('TrailBase returned an invalid list');
      const rows = records.map(row => mapRow<Row>(this.mapping, row));
      if (this.cardinality !== 'many') {
        if (rows.length !== 1 && !(this.cardinality === 'maybeSingle' && rows.length === 0)) {
          const error = new Error(`Expected ${this.cardinality === 'single' ? 'exactly one row' : 'zero or one row'}, received ${rows.length}`);
          error.name = 'CardinalityError';
          throw error;
        }
        return { data: (rows[0] ?? null) as Data | null, error: null };
      }
      return { data: rows as Data, error: null };
    } catch (error) {
      return { data: null, error: normalizeError(error) };
    }
  }
}

class MutationQuery<Row> implements PromiseLike<QueryResult<null>> {
  private key: string | number | undefined;

  constructor(private readonly native: NativeClient, private readonly mapping: TableMapping,
    private readonly operation: 'insert' | 'update' | 'delete', private readonly values?: Record<string, unknown>) {}

  eq<Key extends Column<Row>>(column: Key, value: FilterValue<Row, Key>): this {
    if (arguments.length !== 2) unsupported('Unsupported mutation predicate arguments');
    if (this.operation === 'insert') unsupported('Unsupported insert predicate');
    if (this.key !== undefined) unsupported('Mutations require exactly one primary-key eq');
    if (column !== this.mapping.primaryKey) unsupported('Mutations require a primary-key eq');
    const encoded = fieldToNative(this.mapping.fields[this.mapping.primaryKey], value);
    if (typeof encoded !== 'string' && typeof encoded !== 'number') throw new TypeError('Invalid primary key');
    this.key = encoded;
    return this;
  }

  neq(..._args: never[]): never { return unsupported('Unsupported mutation predicate'); }
  gt(..._args: never[]): never { return unsupported('Unsupported mutation predicate'); }
  gte(..._args: never[]): never { return unsupported('Unsupported mutation predicate'); }
  lt(..._args: never[]): never { return unsupported('Unsupported mutation predicate'); }
  lte(..._args: never[]): never { return unsupported('Unsupported mutation predicate'); }
  order(..._args: never[]): never { return unsupported('Unsupported mutation ordering'); }
  limit(..._args: never[]): never { return unsupported('Unsupported mutation limits'); }
  range(..._args: never[]): never { return unsupported('Unsupported mutation ranges'); }
  select(..._args: never[]): never { return unsupported('Unsupported mutation returning'); }
  single(..._args: never[]): never { return unsupported('Unsupported mutation cardinality'); }
  maybeSingle(..._args: never[]): never { return unsupported('Unsupported mutation cardinality'); }

  then<TResult1 = QueryResult<null>, TResult2 = never>(
    onfulfilled?: ((value: QueryResult<null>) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> { return this.execute().then(onfulfilled, onrejected); }

  private async execute(): Promise<QueryResult<null>> {
    try {
      const records = this.native.records(this.mapping.api);
      if (this.operation === 'insert') {
        // The pinned create client indexes ids[0] before validating the envelope.
        // Use native transport here so malformed replies cannot become success.
        const response = await this.native.fetch(`/api/records/v1/${this.mapping.api}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(this.values),
        });
        const acknowledgement: unknown = await response.json();
        plainObject(acknowledgement, 'Create acknowledgement');
        const ids: unknown = acknowledgement.ids;
        if (!Array.isArray(ids) || ids.length !== 1) throw new TypeError('Create acknowledgement must contain exactly one ID');
        validateCreateId(this.mapping.fields[this.mapping.primaryKey], ids[0]);
      } else {
        if (this.key === undefined) unsupported('Mutations require exactly one explicit primary-key eq');
        if (this.operation === 'update') await records.update(this.key, this.values!);
        else await records.delete(this.key);
      }
      return { data: null, error: null };
    } catch (error) { return { data: null, error: normalizeError(error) }; }
  }
}

class TableBuilder<Row, Insert, Update> {
  constructor(private readonly native: NativeClient, private readonly mapping: TableMapping) {}

  select(columns: '*' = '*'): SelectQuery<Row> {
    if (arguments.length > 1) unsupported('Unsupported select options (count/head)');
    if (columns !== '*') unsupported('Only select(*) is supported');
    return new SelectQuery<Row>(this.native, this.mapping);
  }

  insert(values: Insert): MutationQuery<Row> {
    if (arguments.length !== 1) unsupported('Unsupported insert options');
    return this.mutation('insert', values);
  }

  update(values: Update): MutationQuery<Row> {
    if (arguments.length !== 1) unsupported('Unsupported update options');
    return this.mutation('update', values);
  }

  delete(): MutationQuery<Row> {
    if (arguments.length) unsupported('Unsupported delete options');
    return this.mutation('delete');
  }

  upsert(..._args: never[]): never { return unsupported('Unsupported upsert'); }

  private mutation(operation: 'insert' | 'update' | 'delete', values?: unknown): MutationQuery<Row> {
    if (this.mapping.readOnly) unsupported('Cannot mutate a read-only view');
    const keyField = this.mapping.fields[this.mapping.primaryKey];
    if (keyField.nullable || !['uuid', 'integer'].includes(keyField.type)) unsupported('Unsupported mutation primary-key mapping: requires non-null UUIDv4 or safe integer');
    let encoded: Record<string, unknown> | undefined;
    if (operation !== 'delete') {
      plainObject(values, 'Mutation values');
      const mapped: Record<string, unknown> = Object.create(null);
      for (const [column, value] of Object.entries(values)) {
        const field = mappedField(this.mapping, column);
        if (!field) throw new TypeError(`Unmapped mutation field: ${column}`);
        if (operation === 'update' && column === this.mapping.primaryKey) unsupported('Cannot change the primary key');
        mapped[column] = fieldToNative(field, value);
      }
      encoded = mapped;
    }
    return new MutationQuery<Row>(this.native, this.mapping, operation, encoded);
  }
}

type BuilderOf<Database, Name extends string> = Name extends keyof ViewsOf<Database>
  ? Pick<TableBuilder<ShapeOf<Database, Name, 'Row'>, never, never>, 'select'>
  : TableBuilder<ShapeOf<Database, Name, 'Row'>, ShapeOf<Database, Name, 'Insert'>, ShapeOf<Database, Name, 'Update'>>;

export function createClient<Database = unknown>(url: string, key?: string, options?: ClientOptions) {
  if (arguments.length > 3) unsupported('Unsupported client arguments');
  if (typeof key !== 'undefined' && typeof key !== 'string') throw new TypeError('key must be a string when provided');
  plainObject(options, 'Client options with explicit TrailBase mappings');
  for (const option of Object.keys(options)) if (!['db', 'global', 'trailbase', 'auth'].includes(option)) unsupported(`Unsupported client option: ${option}`);
  if (options.db !== undefined) {
    plainObject(options.db, 'db options');
    if (Object.keys(options.db).some(key => key !== 'schema')) unsupported('Unsupported db option');
    if (options.db.schema !== 'public') unsupported('Only the public schema is supported');
  }
  if (options.global !== undefined) {
    plainObject(options.global, 'global options');
    if (Object.keys(options.global).some(option => option !== 'fetch')) unsupported('Unsupported global client option');
  }
  if (options.global?.fetch !== undefined && typeof options.global.fetch !== 'function') throw new TypeError('global.fetch must be a function');
  validateMapping(options.trailbase);
  const tables = structuredClone(options.trailbase.tables);

  let base: URL;
  try { base = new URL(url); } catch { throw new TypeError('url must be an absolute HTTP(S) URL'); }
  if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash || base.pathname !== '/') {
    throw new TypeError('url must be a credential-free HTTP(S) origin');
  }

  const fetcher = options.global?.fetch ?? globalThis.fetch;
  const auth = createAuth(base, fetcher, options.auth);
  const native = initClient(base, { transport: { fetch: auth.recordFetch } });
  return {
    auth: auth.api,
    from<Name extends RelationNames<Database>>(name: Name): BuilderOf<Database, Name> {
      if (arguments.length !== 1) unsupported('Unsupported from arguments');
      if (typeof name !== 'string') throw new TypeError('Table name must be a string');
      const mapping = Object.hasOwn(tables, name) ? tables[name] : undefined;
      if (!mapping) throw new TypeError(`No TrailBase mapping for table: ${String(name)}`);
      return new TableBuilder(native, mapping) as BuilderOf<Database, Name>;
    },
  };
}
