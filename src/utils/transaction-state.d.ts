import 'sequelize';

declare module 'sequelize' {
  interface Transaction {
    /** Sequelize 6 exposes the completed state at runtime; used to avoid a second rollback. */
    finished?: 'commit' | 'rollback';
  }
}
