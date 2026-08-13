declare module 'react-native-sqlite-storage' {
  export interface ResultSetRowList {
    length: number;
    item(index: number): any;
  }

  export interface ResultSet {
    insertId: number;
    rowsAffected: number;
    rows: ResultSetRowList;
  }

  export interface Transaction {
    executeSql(
      sqlStatement: string,
      arguments?: any[],
      success?: (tx: Transaction, results: ResultSet) => void,
      error?: (tx: Transaction, error: any) => void
    ): void;
  }

  export interface SQLiteDatabase {
    executeSql(
      statement: string,
      params?: any[]
    ): Promise<[ResultSet]>;
    transaction(
      callback: (tx: Transaction) => void
    ): Promise<void>;
    close(): Promise<void>;
  }

  export function openDatabase(
    params: {
      name: string;
      location: string;
    },
    success?: () => void,
    error?: (err: any) => void
  ): Promise<SQLiteDatabase>;

  export function enablePromise(enable: boolean): void;
}
