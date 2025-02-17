const fp = require('lodash/fp');
const _ = require('lodash');
const sql = require('./sql');

const { DatabaseAnalyser } = require('dbgate-tools');
const { isTypeString, isTypeNumeric } = require('dbgate-tools');

function normalizeTypeName(dataType) {
  if (dataType == 'character varying') return 'varchar';
  if (dataType == 'timestamp without time zone') return 'timestamp';
  return dataType;
}

function getColumnInfo({
  is_nullable,
  column_name,
  data_type,
  char_max_length,
  numeric_precision,
  numeric_ccale,
  default_value,
}) {
  const normDataType = normalizeTypeName(data_type);
  let fullDataType = normDataType;
  if (char_max_length && isTypeString(normDataType)) fullDataType = `${normDataType}(${char_max_length})`;
  if (numeric_precision && numeric_ccale && isTypeNumeric(normDataType))
    fullDataType = `${normDataType}(${numeric_precision},${numeric_ccale})`;
  const autoIncrement = !!(default_value && default_value.startsWith('nextval('));
  return {
    columnName: column_name,
    dataType: fullDataType,
    notNull: !is_nullable || is_nullable == 'NO' || is_nullable == 'no',
    defaultValue: autoIncrement ? undefined : default_value,
    autoIncrement,
  };
}

class Analyser extends DatabaseAnalyser {
  constructor(pool, driver, version) {
    super(pool, driver, version);
  }

  createQuery(resFileName, typeFields) {
    const query = super.createQuery(sql[resFileName], typeFields);
    if (query) return query.replace('#REFTABLECOND#', this.driver.__analyserInternals.refTableCond);
    return null;
  }

  async _computeSingleObjectId() {
    const { typeField, schemaName, pureName } = this.singleObjectFilter;
    this.singleObjectId = `${typeField}:${schemaName || 'public'}.${pureName}`;
  }

  async _runAnalysis() {
    const tables = await this.driver.query(
      this.pool,
      this.createQuery(this.driver.dialect.stringAgg ? 'tableModifications' : 'tableList', ['tables'])
    );
    const columns = await this.driver.query(this.pool, this.createQuery('columns', ['tables', 'views']));
    const pkColumns = await this.driver.query(this.pool, this.createQuery('primaryKeys', ['tables']));
    const fkColumns = await this.driver.query(this.pool, this.createQuery('foreignKeys', ['tables']));
    const views = await this.driver.query(this.pool, this.createQuery('views', ['views']));
    const matviews = this.driver.dialect.materializedViews
      ? await this.driver.query(this.pool, this.createQuery('matviews', ['matviews']))
      : null;
    const matviewColumns = this.driver.dialect.materializedViews
      ? await this.driver.query(this.pool, this.createQuery('matviewColumns', ['matviews']))
      : null;
    const routines = await this.driver.query(this.pool, this.createQuery('routines', ['procedures', 'functions']));
    const indexes = this.driver.__analyserInternals.skipIndexes
      ? { rows: [] }
      : await this.driver.query(this.pool, this.createQuery('indexes', ['tables']));
    const indexcols = this.driver.__analyserInternals.skipIndexes
      ? { rows: [] }
      : await this.driver.query(this.pool, this.createQuery('indexcols', ['tables']));
    const uniqueNames = await this.driver.query(this.pool, this.createQuery('uniqueNames', ['tables']));

    return {
      tables: tables.rows.map(table => {
        const newTable = {
          pureName: table.pure_name,
          schemaName: table.schema_name,
          objectId: `tables:${table.schema_name}.${table.pure_name}`,
          contentHash: table.hash_code_columns ? `${table.hash_code_columns}-${table.hash_code_constraints}` : null,
        };
        return {
          ...newTable,
          columns: columns.rows
            .filter(col => col.pure_name == table.pure_name && col.schema_name == table.schema_name)
            .map(getColumnInfo),
          primaryKey: DatabaseAnalyser.extractPrimaryKeys(
            newTable,
            pkColumns.rows.map(x => ({
              pureName: x.pure_name,
              schemaName: x.schema_name,
              constraintSchema: x.constraint_schema,
              constraintName: x.constraint_name,
              columnName: x.column_name,
            }))
          ),
          foreignKeys: DatabaseAnalyser.extractForeignKeys(
            newTable,
            fkColumns.rows.map(x => ({
              pureName: x.pure_name,
              schemaName: x.schema_name,
              constraintSchema: x.constraint_schema,
              constraintName: x.constraint_name,
              columnName: x.column_name,
              refColumnName: x.ref_column_name,
              updateAction: x.update_action,
              deleteAction: x.delete_action,
              refTableName: x.ref_table_name,
              refSchemaName: x.ref_schema_name,
            }))
          ),
          indexes: indexes.rows
            .filter(
              x =>
                x.table_name == table.pure_name &&
                x.schema_name == table.schema_name &&
                !uniqueNames.rows.find(y => y.constraint_name == x.index_name)
            )
            .map(idx => ({
              constraintName: idx.index_name,
              isUnique: idx.is_unique,
              columns: _.compact(
                idx.indkey
                  .split(' ')
                  .map(colid => indexcols.rows.find(col => col.oid == idx.oid && col.attnum == colid))
                  .filter(col => col != null)
                  .map(col => ({
                    columnName: col.column_name,
                  }))
              ),
            })),
          uniques: indexes.rows
            .filter(
              x =>
                x.table_name == table.pure_name &&
                x.schema_name == table.schema_name &&
                uniqueNames.rows.find(y => y.constraint_name == x.index_name)
            )
            .map(idx => ({
              constraintName: idx.index_name,
              columns: _.compact(
                idx.indkey
                  .split(' ')
                  .map(colid => indexcols.rows.find(col => col.oid == idx.oid && col.attnum == colid))
                  .filter(col => col != null)
                  .map(col => ({
                    columnName: col.column_name,
                  }))
              ),
            })),
        };
      }),
      views: views.rows.map(view => ({
        objectId: `views:${view.schema_name}.${view.pure_name}`,
        pureName: view.pure_name,
        schemaName: view.schema_name,
        contentHash: view.hash_code,
        createSql: `CREATE VIEW "${view.schema_name}"."${view.pure_name}"\nAS\n${view.create_sql}`,
        columns: columns.rows
          .filter(col => col.pure_name == view.pure_name && col.schema_name == view.schema_name)
          .map(getColumnInfo),
      })),
      matviews: matviews
        ? matviews.rows.map(matview => ({
            objectId: `matviews:${matview.schema_name}.${matview.pure_name}`,
            pureName: matview.pure_name,
            schemaName: matview.schema_name,
            contentHash: matview.hash_code,
            createSql: `CREATE MATERIALIZED VIEW "${matview.schema_name}"."${matview.pure_name}"\nAS\n${matview.definition}`,
            columns: matviewColumns.rows
              .filter(col => col.pure_name == matview.pure_name && col.schema_name == matview.schema_name)
              .map(getColumnInfo),
          }))
        : undefined,
      procedures: routines.rows
        .filter(x => x.object_type == 'PROCEDURE')
        .map(proc => ({
          objectId: `procedures:${proc.schema_name}.${proc.pure_name}`,
          pureName: proc.pure_name,
          schemaName: proc.schema_name,
          createSql: `CREATE PROCEDURE "${proc.schema_name}"."${proc.pure_name}"() LANGUAGE ${proc.language}\nAS\n$$\n${proc.definition}\n$$`,
          contentHash: proc.hash_code,
        })),
      functions: routines.rows
        .filter(x => x.object_type == 'FUNCTION')
        .map(func => ({
          objectId: `functions:${func.schema_name}.${func.pure_name}`,
          createSql: `CREATE FUNCTION "${func.schema_name}"."${func.pure_name}"() RETURNS ${func.data_type} LANGUAGE ${func.language}\nAS\n$$\n${func.definition}\n$$`,
          pureName: func.pure_name,
          schemaName: func.schema_name,
          contentHash: func.hash_code,
        })),
    };
  }

  async _getFastSnapshot() {
    const tableModificationsQueryData = this.driver.dialect.stringAgg
      ? await this.driver.query(this.pool, this.createQuery('tableModifications'))
      : null;
    const viewModificationsQueryData = await this.driver.query(this.pool, this.createQuery('viewModifications'));
    const matviewModificationsQueryData = this.driver.dialect.materializedViews
      ? await this.driver.query(this.pool, this.createQuery('matviewModifications'))
      : null;
    const routineModificationsQueryData = await this.driver.query(this.pool, this.createQuery('routineModifications'));

    return {
      tables: tableModificationsQueryData
        ? tableModificationsQueryData.rows.map(x => ({
            objectId: `tables:${x.schema_name}.${x.pure_name}`,
            pureName: x.pure_name,
            schemaName: x.schema_name,
            contentHash: `${x.hash_code_columns}-${x.hash_code_constraints}`,
          }))
        : null,
      views: viewModificationsQueryData.rows.map(x => ({
        objectId: `views:${x.schema_name}.${x.pure_name}`,
        pureName: x.pure_name,
        schemaName: x.schema_name,
        contentHash: x.hash_code,
      })),
      matviews: matviewModificationsQueryData
        ? matviewModificationsQueryData.rows.map(x => ({
            objectId: `matviews:${x.schema_name}.${x.pure_name}`,
            pureName: x.pure_name,
            schemaName: x.schema_name,
            contentHash: x.hash_code,
          }))
        : undefined,
      procedures: routineModificationsQueryData.rows
        .filter(x => x.object_type == 'PROCEDURE')
        .map(x => ({
          objectId: `procedures:${x.schema_name}.${x.pure_name}`,
          pureName: x.pure_name,
          schemaName: x.schema_name,
          contentHash: x.hash_code,
        })),
      functions: routineModificationsQueryData.rows
        .filter(x => x.object_type == 'FUNCTION')
        .map(x => ({
          objectId: `functions:${x.schema_name}.${x.pure_name}`,
          pureName: x.pure_name,
          schemaName: x.schema_name,
          contentHash: x.hash_code,
        })),
    };
  }
}

module.exports = Analyser;
