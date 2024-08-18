"use strict";
const Database = require("better-sqlite3");

class pathsDatabase {
  constructor(path) {
    this.db = new Database(path);
    this.initialize();
  }

  initialize() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS paths (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        val VARCHAR(64)
      );
    `);
  }

  insertPath(json) {
    try {
      const stmnt = this.db.prepare("INSERT INTO paths (val) VALUES (?)");
      stmnt.run(json);
      // console.log("Path inserted");
    } catch (err) {
      console.error("Error inserting path", err);
    }
  }

  insertPaths(jsonArray) {
    const insert = this.db.prepare("INSERT INTO paths (val) VALUES (?)");
    const insertMany = this.db.transaction((jsonArray) => {
      for (const json of jsonArray) {
        insert.run(JSON.stringify(json));
      }
    });

    try {
      insertMany(jsonArray);
      console.log("Paths inserted");
    } catch (err) {
      console.error("Error inserting paths", err);
    }
  }

  getLastPaths(limit) {
    try {
      const stmnt = this.db.prepare(
        `SELECT id, val FROM paths ORDER BY id DESC LIMIT ?`
      );
      const rows = stmnt.all(limit);
      return rows;
    } catch (err) {
      console.error("Error getting last paths", err);
      return [];
    }
  }

  deletePath(json) {
    try {
      const stmnt = this.db.prepare("DELETE FROM paths WHERE val = ?");
      stmnt.run(json);
      console.log("Path deleted");
    } catch (err) {
      console.error("Error deleting path", err);
    }
  }

  deletePathsByIds(ids) {
    try {
      const deleteMany = this.db.transaction((ids) => {
        for (const id of ids) {
          const stmnt = this.db.prepare("DELETE FROM paths WHERE id = ?");
          stmnt.run(id);
        }
      });

      deleteMany(ids);
      console.log("Paths deleted");
    } catch (err) {
      console.error("Error deleting paths", err);
    }
  }

  deleteAllPaths() {
    try {
      const stmnt = this.db.prepare("DELETE FROM paths");
      stmnt.run();
      console.log("All paths deleted");
    } catch (err) {
      console.error("Error deleting all paths", err);
    }
  }

  pathExists(path) {
    try {
      const stmnt = this.db.prepare(
        "SELECT 1 FROM paths WHERE val = ? LIMIT 1"
      );
      const row = stmnt.get(path);
      return !!row;
    } catch (err) {
      console.error("Error searching path", err);
      return false;
    }
  }

  getSize() {
    try {
      const stmnt = this.db.prepare("SELECT COUNT(*) as count FROM paths");
      const row = stmnt.get();
      return row.count;
    } catch (err) {
      console.error("Error getting size", err);
      return 0;
    }
  }

  close() {
    try {
      this.db.close();
      console.log("Database closed");
    } catch (err) {
      console.error("Error closing database", err);
    }
  }
}

module.exports = pathsDatabase;
