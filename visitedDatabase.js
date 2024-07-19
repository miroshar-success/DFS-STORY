"use strict";
const sqlite3 = require("sqlite3").verbose();

class VisitedDatabase {
  constructor(path) {
    this.db = new sqlite3.Database(path, (err) => {
      if (err) {
        console.error("Could not connect to database", err);
      } else {
        console.log("Connected to database");
      }
    });
    this.initialize();
  }

  initialize() {
    this.db.serialize(() => {
      this.db.run(`CREATE TABLE IF NOT EXISTS visited (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          path VARCHAR(64)
      )`);

      this.db.run(
        `CREATE INDEX IF NOT EXISTS idx_path ON visited (path)`,
        (err) => {
          if (err) {
            console.error("Error creating index", err);
          } else {
            console.log("Index created");
          }
        }
      );
    });
  }

  insertPath(path) {
    const stmnt = this.db.prepare("INSERT INTO visited (path) VALUES (?)");
    stmnt.run(path, (err) => {
      if (err) {
        console.error("Error inserting path", err);
      } else {
        console.log("Path inserted");
      }
    });
    stmnt.finalize();
  }

  deletePath(path) {
    const stmnt = this.db.prepare("DELETE FROM visited WHERE path = ?");
    stmnt.run(path, (err) => {
      if (err) {
        console.error("Error deleting path", err);
      } else {
        console.log("Path deleted");
      }
    });
    stmnt.finalize();
  }

  pathExists(path) {
    return new Promise((resolve, reject) => {
      this.db.get(
        "SELECT 1 FROM visited WHERE path = ? LIMIT 1",
        [path],
        (err, row) => {
          if (err) {
            console.error("Error searching path", err);
            reject(err);
          } else {
            resolve(!!row);
          }
        }
      );
    });
  }

  deleteAllPaths() {
    return new Promise((resolve, reject) => {
      this.db.run("DELETE FROM visited", (err) => {
        if (err) {
          console.error("Error deleting all paths", err);
          reject(err);
        } else {
          console.log("All paths deleted");
          resolve();
        }
      });
    });
  }

  getSize() {
    return new Promise((resolve, reject) => {
      this.db.get("SELECT COUNT(*) as count FROM visited", (err, row) => {
        if (err) {
          console.error("Error getting size", err);
          reject(err);
        } else {
          resolve(row.count);
        }
      });
    });
  }

  close() {
    this.db.close((err) => {
      if (err) {
        console.error("Error closing database", err);
      } else {
        console.log("Database closed");
      }
    });
  }
}

module.exports = VisitedDatabase;
