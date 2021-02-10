/**
 * This is a simple template for bug reproductions. It contains three models `Person`, `Animal` and `Movie`.
 * They create a simple IMDB-style database. Try to add minimal modifications to this file to reproduce
 * your bug.
 *
 * install:
 *    npm install objection knex sqlite3 chai
 *
 * run:
 *    node reproduction-template
 */

let Model;

try {
  Model = require('./').Model;
} catch (err) {
  Model = require('objection').Model;
}

const Knex = require('knex');
const chai = require('chai');

async function main() {
  await createSchema();

  ///////////////////////////////////////////////////////////////
  // Your reproduction
  ///////////////////////////////////////////////////////////////

  // Grab a connection from the pool. We're using sqlite3 for which knex
  // uses a max pool size of 1, so the DB connection pool will be empty
  // after this line.
  const trx = await Person.startTransaction();

  // Now that the DB connection pool is empty, make a query without
  // using the above transaction. This will attempt to get another
  // connection from the pool which will time out. This seems to put
  // Objection into a weird state that causes future queries to fail.
  try {
    await Person.query().withGraphJoined('pets');
  } catch (e) {
    chai.expect(e).to.be.an.instanceof(Knex.KnexTimeoutError);
  }

  // Release the first connection so the connection pool has free
  // connections again.
  trx.rollback();

  console.log(Date.now(), 'Attempting another query.');
  try {
    // This incorrectly throws KnexTimeoutError. If you look at the
    // timestamps in the log messages you'll see that it fails
    // immediately. If it truly timed out then the exception would
    // happen two seconds later (or whatever the configured pool
    // timeout is).
    //
    // Some interesting data points:
    // - This query only fails if both this query and the above query
    //   use withGraphJoined().
    // - This query only fails if the above query runs early on in the
    //   life of the process. For example, if you copy/paste the query
    //   to the top of this script before the call to
    //   Person.startTransaction() so that it runs successfully once,
    //   and leave everything else the same, then this query succeeds!
    //   I looked at the some of the eager operation code... I see some
    //   references to fetchTableMetadata() that look like it does a
    //   preliminary query before doing the actual query. Is it possible
    //   that query is failing and leaving something in a weird state?
    await Person.query().withGraphJoined('pets');
  } catch (e) {
    console.error(Date.now(), 'It failed! This should not have happened. Error was', e);
    chai.expect.fail('Query failed.');
  }
}

///////////////////////////////////////////////////////////////
// Database
///////////////////////////////////////////////////////////////

const knex = Knex({
  client: 'sqlite3',
  useNullAsDefault: true,
  debug: false,
  pool: {
    // Set shorter timeouts because the defaults are long and we don't
    // want to wait that long every time we run this test.
    acquireTimeoutMillis: 2000,
    createTimeoutMillis: 2000
  },
  connection: {
    filename: ':memory:'
  }
});

Model.knex(knex);

///////////////////////////////////////////////////////////////
// Models
///////////////////////////////////////////////////////////////

class Person extends Model {
  static get tableName() {
    return 'Person';
  }

  static get jsonSchema() {
    return {
      type: 'object',
      required: ['firstName', 'lastName'],

      properties: {
        id: { type: 'integer' },
        parentId: { type: ['integer', 'null'] },
        firstName: { type: 'string', minLength: 1, maxLength: 255 },
        lastName: { type: 'string', minLength: 1, maxLength: 255 },
        age: { type: 'number' },

        address: {
          type: 'object',
          properties: {
            street: { type: 'string' },
            city: { type: 'string' },
            zipCode: { type: 'string' }
          }
        }
      }
    };
  }

  static get relationMappings() {
    return {
      pets: {
        relation: Model.HasManyRelation,
        modelClass: Animal,
        join: {
          from: 'Person.id',
          to: 'Animal.ownerId'
        }
      },

      movies: {
        relation: Model.ManyToManyRelation,
        modelClass: Movie,
        join: {
          from: 'Person.id',
          through: {
            from: 'Person_Movie.personId',
            to: 'Person_Movie.movieId'
          },
          to: 'Movie.id'
        }
      },

      children: {
        relation: Model.HasManyRelation,
        modelClass: Person,
        join: {
          from: 'Person.id',
          to: 'Person.parentId'
        }
      },

      parent: {
        relation: Model.BelongsToOneRelation,
        modelClass: Person,
        join: {
          from: 'Person.parentId',
          to: 'Person.id'
        }
      }
    };
  }
}

class Animal extends Model {
  static get tableName() {
    return 'Animal';
  }

  static get jsonSchema() {
    return {
      type: 'object',
      required: ['name'],

      properties: {
        id: { type: 'integer' },
        ownerId: { type: ['integer', 'null'] },
        name: { type: 'string', minLength: 1, maxLength: 255 },
        species: { type: 'string', minLength: 1, maxLength: 255 }
      }
    };
  }

  static get relationMappings() {
    return {
      owner: {
        relation: Model.BelongsToOneRelation,
        modelClass: Person,
        join: {
          from: 'Animal.ownerId',
          to: 'Person.id'
        }
      }
    };
  }
}

class Movie extends Model {
  static get tableName() {
    return 'Movie';
  }

  static get jsonSchema() {
    return {
      type: 'object',
      required: ['name'],

      properties: {
        id: { type: 'integer' },
        name: { type: 'string', minLength: 1, maxLength: 255 }
      }
    };
  }

  static get relationMappings() {
    return {
      actors: {
        relation: Model.ManyToManyRelation,
        modelClass: Person,
        join: {
          from: 'Movie.id',
          through: {
            from: 'Person_Movie.movieId',
            to: 'Person_Movie.personId'
          },
          to: 'Person.id'
        }
      }
    };
  }
}

///////////////////////////////////////////////////////////////
// Schema
///////////////////////////////////////////////////////////////

async function createSchema() {
  await knex.schema
    .dropTableIfExists('Person_Movie')
    .dropTableIfExists('Animal')
    .dropTableIfExists('Movie')
    .dropTableIfExists('Person');

  await knex.schema
    .createTable('Person', table => {
      table.increments('id').primary();
      table
        .integer('parentId')
        .unsigned()
        .references('id')
        .inTable('Person');
      table.string('firstName');
      table.string('lastName');
      table.integer('age');
      table.json('address');
    })
    .createTable('Movie', table => {
      table.increments('id').primary();
      table.string('name');
    })
    .createTable('Animal', table => {
      table.increments('id').primary();
      table
        .integer('ownerId')
        .unsigned()
        .references('id')
        .inTable('Person');
      table.string('name');
      table.string('species');
    })
    .createTable('Person_Movie', table => {
      table.increments('id').primary();
      table
        .integer('personId')
        .unsigned()
        .references('id')
        .inTable('Person')
        .onDelete('CASCADE');
      table
        .integer('movieId')
        .unsigned()
        .references('id')
        .inTable('Movie')
        .onDelete('CASCADE');
    });
}

main()
  .then(() => {
    console.log('success');
    return knex.destroy();
  })
  .catch(err => {
    console.error(err);
    return knex.destroy();
  });
