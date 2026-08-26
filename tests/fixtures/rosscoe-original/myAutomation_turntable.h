/*
 * myAutomation_turntable.h
 *
 */


DCC_TURNTABLE(1, 200)
TT_ADDPOSITION(1, 1, 200, 0, "Entry")
TT_ADDPOSITION(1, 2, 202, 180, "Exit")

ROUTE(1, "T:Move TT 1 to 1")
ROTATE_DCC(1, 1)
DONE

ROUTE(2, "T:Move TT 1 to 1")
ROTATE_DCC(1, 2)
DONE

