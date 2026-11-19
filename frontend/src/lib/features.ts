/** UI feature flags. Flip a value to show/hide a feature without touching the pages. */
export const FEATURES = {
  /**
   * Everything "application-wise": the Application filter, application charts (ticket distribution, workload,
   * deployment by application), Application table columns / KPIs and the application report type.
   * Hidden on request; set to true to bring it all back.
   */
  applications: false,
  /** "Work type by employee" chart on the Executive dashboard. */
  workTypeByEmployee: false,
  /** "Data quality" card on the Executive dashboard. */
  dataQualityCard: false,
  /** "Calculation rules & data limitations" sections (Executive, Jira Analytics). */
  calculationRules: false,
} as const

