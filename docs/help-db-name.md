List the databases that actually exist in the target container

The migration stopped because psql could not open a database named
db_sales_novacore, and the old version of the script swallowed the
reason. Run this to see what is really there:

    docker exec kqgwtzqknu9axud1urkau5si psql -U postgres -l

or, without the pager and with just the names:

    docker exec -i kqgwtzqknu9axud1urkau5si psql -U postgres -tAc \
      "SELECT datname FROM pg_database WHERE datistemplate = false ORDER BY 1;"

Whatever comes back, set it before running the migration:

    export DB_NAME='<the name that appears>'

This is also a good moment to confirm the container is the one you think it
is - it should be the crm-sales-db resource, not one of the other three
projects sharing that PostgreSQL instance:

    docker ps --format '{{.Names}}' | grep -i postgres
