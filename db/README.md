# db/

PostgreSQL schema for the School Management Platform: 26 schemas and 280 tables. It is SQL-first, with ordered migrations.

* Full documentation: [`docs/database/README.md`](../docs/database/README.md)
* Data dictionary (one ER diagram and table list per schema): [`docs/database/schemas/`](../docs/database/schemas/README.md)

```bash
psql -U postgres -d postgres -v db=school_platform -f db/migrations/0000_bootstrap.sql   # once, superuser
PGUSER=sms_owner PGDATABASE=school_platform bash db/tools/migrate.sh                     # migrations
psql -U sms_owner -d school_platform -f db/seeds/0001_permissions.sql \
     -f db/seeds/0002_organisation_reference_data.sql                                    # reference data
psql -U sms_app -d school_platform -v ON_ERROR_STOP=1 -f db/tests/invariants.sql         # invariant tests
DB=school_platform_dev bash db/tools/rebuild-and-test.sh                                 # dev/CI full rebuild
```
