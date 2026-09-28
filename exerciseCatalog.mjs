import catalog from './exerciseCatalog.json' with { type: 'json' }
export const EXERCISE_CATALOG = catalog.exercises
export const STARTER_EQUIPMENT_NAMES = catalog.exercises.map((e) => e.name)
export default catalog
