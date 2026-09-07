/**
 * Space Zero — agent tool registry. Server-side only.
 *
 * The four foundation tools, in the order the autonomous loop uses them:
 * observe (get_trip), reason about limits (check_authority), find options
 * (recover_trip), act through the single money path (execute_booking).
 */

import { getTripTool } from "./get-trip";
import { checkAuthorityTool } from "./check-authority";
import { recoverTripTool } from "./recover-trip";
import { executeBookingTool } from "./execute-booking";
import { searchFlightsTool } from "./search-flights";

export { getTripTool } from "./get-trip";
export { checkAuthorityTool } from "./check-authority";
export { recoverTripTool } from "./recover-trip";
export { executeBookingTool } from "./execute-booking";
export { searchFlightsTool } from "./search-flights";

export const spaceZeroTools = [
  getTripTool,
  checkAuthorityTool,
  recoverTripTool,
  executeBookingTool,
  searchFlightsTool,
];
