#!/usr/bin/env python3
"""Merge Beta-owned accounts and user rows into the shared SQLite database."""

import argparse
import os
import shutil
import sqlite3
import tempfile


def quote(name):
    return '"' + name.replace('"', '""') + '"'


def table_columns(db, table):
    return [row[1] for row in db.execute(f'PRAGMA table_info({quote(table)})')]


def table_names(db):
    return [row[0] for row in db.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    )]


def integrity(db):
    result = db.execute('PRAGMA integrity_check').fetchone()[0]
    if result != 'ok':
        raise RuntimeError(f'SQLite integrity check failed: {result}')


def merge(source_path, target_path):
    source = sqlite3.connect(f'file:{source_path}?mode=ro', uri=True)
    target = sqlite3.connect(target_path)
    source.row_factory = sqlite3.Row
    target.row_factory = sqlite3.Row
    try:
        integrity(source)
        integrity(target)
        if source.execute('PRAGMA user_version').fetchone()[0] != target.execute('PRAGMA user_version').fetchone()[0]:
            raise RuntimeError('Source and target schema versions differ')

        source_users = source.execute('SELECT * FROM users ORDER BY id').fetchall()
        target_users = target.execute('SELECT * FROM users').fetchall()
        source_user_columns = table_columns(source, 'users')
        target_user_columns = table_columns(target, 'users')
        if source_user_columns != target_user_columns:
            raise RuntimeError('Source and target users table schemas differ')

        existing_names = {str(row['username']).casefold() for row in target_users}
        duplicates = [str(row['username']) for row in source_users if str(row['username']).casefold() in existing_names]
        if duplicates:
            raise RuntimeError(f'Username collision; no data changed ({len(duplicates)} account(s))')

        source_tables = table_names(source)
        user_tables = [name for name in source_tables if 'user_id' in table_columns(source, name)]
        if 'provider_credentials' in user_tables:
            count = source.execute('SELECT COUNT(*) FROM provider_credentials').fetchone()[0]
            if count:
                raise RuntimeError('Beta has encrypted provider credentials; re-encrypt them before merging')

        target.execute('PRAGMA foreign_keys=ON')
        target.execute('BEGIN IMMEDIATE')
        try:
            target_tables = set(table_names(target))
            for table in user_tables:
                if table in target_tables:
                    if table_columns(source, table) != table_columns(target, table):
                        raise RuntimeError(f'Table schema differs: {table}')
                else:
                    create_sql = source.execute(
                        "SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (table,)
                    ).fetchone()[0]
                    target.execute(create_sql)
                    for row in source.execute(
                        "SELECT sql FROM sqlite_master WHERE type='index' AND tbl_name=? AND sql IS NOT NULL", (table,)
                    ):
                        target.execute(row[0])

            user_id_map = {}
            columns = [name for name in source_user_columns if name != 'id']
            insert_user = target.cursor()
            sql = f"INSERT INTO users ({','.join(map(quote, columns))}) VALUES ({','.join('?' for _ in columns)})"
            for row in source_users:
                cursor = insert_user.execute(sql, [row[name] for name in columns])
                user_id_map[row['id']] = cursor.lastrowid

            copied = {}
            for table in user_tables:
                columns = table_columns(source, table)
                quoted_columns = ','.join(map(quote, columns))
                insert_sql = f"INSERT INTO {quote(table)} ({quoted_columns}) VALUES ({','.join('?' for _ in columns)})"
                count = 0
                for row in source.execute(f'SELECT * FROM {quote(table)}'):
                    values = [user_id_map[row['user_id']] if name == 'user_id' else row[name] for name in columns]
                    target.execute(insert_sql, values)
                    count += 1
                copied[table] = count

            violations = target.execute('PRAGMA foreign_key_check').fetchall()
            if violations:
                raise RuntimeError(f'Foreign-key check failed ({len(violations)} violation(s))')
            target.commit()
        except Exception:
            target.rollback()
            raise

        integrity(target)
        print(f'accounts_merged={len(user_id_map)}')
        for table, count in sorted(copied.items()):
            print(f'{table}={count}')
    finally:
        source.close()
        target.close()


def snapshot(source, destination):
    src = sqlite3.connect(f'file:{source}?mode=ro', uri=True)
    dst = sqlite3.connect(destination)
    try:
        src.backup(dst)
    finally:
        dst.close()
        src.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('source', help='Beta SQLite database')
    parser.add_argument('target', help='Shared SQLite database')
    parser.add_argument('--dry-run', action='store_true', help='merge disposable online backups only')
    args = parser.parse_args()

    if args.source == args.target or not os.path.isfile(args.source) or not os.path.isfile(args.target):
        parser.error('source and target must be distinct existing database files')

    if args.dry_run:
        with tempfile.TemporaryDirectory(prefix='beta-merge-') as temp:
            source_copy = os.path.join(temp, 'beta.db')
            target_copy = os.path.join(temp, 'shared.db')
            snapshot(args.source, source_copy)
            snapshot(args.target, target_copy)
            merge(source_copy, target_copy)
        print('dry_run=ok; original databases unchanged')
    else:
        merge(args.source, args.target)


if __name__ == '__main__':
    main()
