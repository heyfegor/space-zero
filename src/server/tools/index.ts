/**
 * Space Zero — agent tool registry. Server-side only.
 *
 * The autonomous loop, in the order it uses them: observe (get_trip), reason
 * about limits (check_authority), find/rank options (recover_trip,
 * search_flights), and act through the single money path (execute_booking).
 *
 * Recovery adds a dedicated set the agent orchestrates on a disruption:
 * get_recovery_context → search_recovery_options → evaluate_recovery_options →
 * execute_booking. Every decision inside them is deterministic backend code.
 */

import { getTripTool } from "./get-trip";
import { checkAuthorityTool } from "./check-authority";
import { recoverTripTool } from "./recover-trip";
import { executeBookingTool } from "./execute-booking";
import { searchFlightsTool } from "./search-flights";
import { getRecoveryContextTool } from "./get-recovery-context";
import { searchRecoveryOptionsTool } from "./search-recovery-options";
import { evaluateRecoveryOptionsTool } from "./evaluate-recovery-options";

export { getTripTool } from "./get-trip";
export { checkAuthorityTool } from "./check-authority";
export { recoverTripTool } from "./recover-trip";
export { executeBookingTool } from "./execute-booking";
export { searchFlightsTool } from "./search-flights";
export { getRecoveryContextTool } from "./get-recovery-context";
export { searchRecoveryOptionsTool } from "./search-recovery-options";
export { evaluateRecoveryOptionsTool } from "./evaluate-recovery-options";

export const spaceZeroTools = [
  getTripTool,
  checkAuthorityTool,
  recoverTripTool,
  executeBookingTool,
  searchFlightsTool,
  getRecoveryContextTool,
  searchRecoveryOptionsTool,
  evaluateRecoveryOptionsTool,
];
