/*
 * myAutomation_lower_double.h
 */


/*
 * turnout aliases
 */

ALIAS(TRN_PARK_1_ENTRY, 1000)
ALIAS(TRN_PARK_1_EXIT, 1001)
ALIAS(TRN_PARK_2_ENTRY, 1002)
ALIAS(TRN_PARK_2_EXIT, 1003)
ALIAS(TRN_PARK_3_ENTRY, 1004)
ALIAS(TRN_PARK_3_EXIT, 1005)
ALIAS(TRN_PARK_4_ENTRY, 1006)
ALIAS(TRN_PARK_4_EXIT, 1007)
ALIAS(TRN_PARK_5_ENTRY, 1008)
ALIAS(TRN_PARK_5_EXIT, 1009)
ALIAS(TRN_PARK_6_EXIT, 1010)


ALIAS(TRN_PARK_LOOP_ENTRY, 1011)

ALIAS(TRN_PARK_7_ENTRY, 1012)
ALIAS(TRN_PARK_7_EXIT, 1013)

/*
 * turnout declarations
 */

TURNOUT(TRN_PARK_1_ENTRY, 20, 0, "0:Park 1 entry")       // linear 77
TURNOUT(TRN_PARK_2_ENTRY, 20, 1, "0:Park 2 entry")       // linear 78
TURNOUT(TRN_PARK_3_ENTRY, 20, 2, "0:Park 3 entry")       // linear 79
TURNOUT(TRN_PARK_4_ENTRY, 20, 3, "0:Park 4 entry")       // linear 80
TURNOUT(TRN_PARK_5_ENTRY, 21, 0, "0:Park 5 entry")       // linear 81

TURNOUT(TRN_PARK_1_EXIT, 22, 0, "0:Park 1 exit")         // linear 85
TURNOUT(TRN_PARK_2_EXIT, 22, 1, "0:Park 2 exit")         // linear 86
TURNOUT(TRN_PARK_3_EXIT, 22, 2, "0:Park 3 exit")         // linear 87
TURNOUT(TRN_PARK_4_EXIT, 22, 3, "0:Park 4 exit")         // linear 88
TURNOUT(TRN_PARK_5_EXIT, 23, 0, "0:Park 5 exit")         // linear 89
TURNOUT(TRN_PARK_6_EXIT, 23, 1, "0:Park 6 exit")         // linear 90

TURNOUT(TRN_PARK_LOOP_ENTRY, 23, 2, "0:Loop entry")      // linear 91

TURNOUT(TRN_PARK_7_ENTRY, 40, 3, "0:Park 7 entry")       // linear 160
TURNOUT(TRN_PARK_7_EXIT, 41, 0, "0:Park 7 exit")         // linear 161
//TURNOUTL(TRN_PARK_7_EXIT, 161, "0:Park 7 exit")         // linear 161

/*
 * sensor aliases
 */

                                         // I2C Pin

ALIAS(SNS_PARK_1_STOP, 164)              // 20 PA0        IR 3mm
ALIAS(SNS_PARK_2_STOP, 165)              // 20 PA1        IR 3mm
ALIAS(SNS_PARK_3_STOP, 166)              // 20 PA2        IR 3mm
ALIAS(SNS_PARK_4_STOP, 167)              // 20 PA3        IR 3mm
ALIAS(SNS_PARK_5_STOP, 168)              // 20 PA4        IR 3mm
ALIAS(SNS_PARK_6_STOP, 169)              // 20 PA5        IR 3mm


ALIAS(SNS_PARK_1_ENTRY, 172)             // 20 PB0        IR 3mm
ALIAS(SNS_PARK_2_ENTRY, 173)             // 20 PB1        IR 3mm
ALIAS(SNS_PARK_3_ENTRY, 174)             // 20 PB2        IR 3mm
ALIAS(SNS_PARK_4_ENTRY, 175)             // 20 PB3        IR 3mm
ALIAS(SNS_PARK_5_ENTRY, 176)             // 20 PB4        IR 3mm
ALIAS(SNS_PARK_6_ENTRY, 177)             // 20 PB5        IR 3mm

ALIAS(SNS_PARK_2_STOP_SHORT, 213)        // 23 PA1        IR 3mm

//ALIAS(SNS_PARK_7_ENTRY, )               //              IR 3mm USE SNS_PARK_2_ENTRY
ALIAS(SNS_PARK_7_STOP, 212)              // 23 PA0        IR 3mm

ALIAS(SNS_HELIX_BOTTOM, 170)             // 20 PA6        IR 3mm

ALIAS(SNS_HELIX_TOP, 209)                // 22 PB5 13     IR 3mm


ALIAS(SNS_YARD_EXIT, 178)                // 20 PB6        IR 3mm

ALIAS(SNS_SHUNTER_STOP, 171)             //  

ALIAS(SNS_SHUNTER_ENTRY, 179)            //  


//ALIAS(SNS_HELIX_MID, 181)                 // 21 

/*
 * block aliases
 */

ALIAS(BLK_PARK_1, 100)
ALIAS(BLK_PARK_2, 101)
ALIAS(BLK_PARK_2_SHORT, 102)
ALIAS(BLK_PARK_3, 103)
ALIAS(BLK_PARK_4, 104)
ALIAS(BLK_PARK_5, 105)
ALIAS(BLK_PARK_6, 106)

ALIAS(BLK_PARK_7, 107)


ALIAS(BLK_LOWER_LOOP_ENTRY, 110)        // where all the entry turnouts are
ALIAS(BLK_LOWER_LOOP_EXIT, 111)         // where all the exit turnouts are
ALIAS(BLK_LOWER_LOOP_END, 112)          // between TRN_PARK_6_EXIT to TURN_LOOP_EXIT

ALIAS(BLK_SHUNTER_SIDING, 120)

ALIAS(BLK_HELIX_BOTTOM, 130)                   // the helix
ALIAS(BLK_HELIX_TOP, 131)


/*
 * automation and route aliases
 */

ALIAS(FREE_LOWER, 4200)            // free all lower reserves

/*
ALIAS(RTE_PARK_1_EXIT, 1200)       // exit park 1 and go to SNS_YARD_EXIT
ALIAS(RTE_PARK_2_EXIT, 1201)       // exit park 2 and go to SNS_YARD_EXIT
ALIAS(RTE_PARK_3_EXIT, 1202)       // exit park 3 and go to SNS_YARD_EXIT
ALIAS(RTE_PARK_4_EXIT, 1203)       // exit park 4 and go to SNS_YARD_EXIT
ALIAS(RTE_PARK_5_EXIT, 1204)       // exit park 5 and go to SNS_YARD_EXIT
ALIAS(RTE_PARK_6_EXIT, 1205)       // exit park 6 and go to SNS_YARD_EXIT


ALIAS(RTE_PARK_1_ENTRY, 1210)       // enter park 1 from SNS_YARD_EXIT
ALIAS(RTE_PARK_2_ENTRY, 1211)       // enter park 2 from SNS_YARD_EXIT
ALIAS(RTE_PARK_3_ENTRY, 1212)       // enter park 3 from SNS_YARD_EXIT
ALIAS(RTE_PARK_4_ENTRY, 1213)       // enter park 4 from SNS_YARD_EXIT
ALIAS(RTE_PARK_5_ENTRY, 1214)       // enter park 5 from SNS_YARD_EXIT
ALIAS(RTE_PARK_6_ENTRY, 1215)       // enter park 6 from SNS_YARD_EXIT
*/

ALIAS(RTE_PARK_ANY_ENTRY, 1216)    // enter park from platform 6 to SNS_YARD_EXIT depending on loco
ALIAS(RTE_PARK_ANY_ENTRY_2, 1217)    // enter park from platform 5 to SNS_YARD_EXIT depending on loco

ALIAS(RTE_PARK_ANY_EXIT, 1218)     // exit park from any parking track depending on loco

ALIAS(RTE_SHUNTER_EXIT, 1220)      // from shunter siding to SNS_YARD_EXIT
ALIAS(RTE_SHUNTER_ENTRY, 1221)     // from SNS_YARD_EXIT to shunter siding

ALIAS(RTE_PARK_7_EXIT, 1230)       // exit park 7 and go to SNS_YARD_EXIT
ALIAS(RTE_PARK_7_ENTRY, 1231)       // enter park 7 from SNS_YARD_EXIT


/*
 * sequence aliases
 */
/*
ALIAS(SEQ_PARK_1_EXIT, 1300)        // exit park 1 and go to SNS_YARD_EXIT
ALIAS(SEQ_PARK_2_EXIT, 1301)        // exit park 2 and go to SNS_YARD_EXIT
ALIAS(SEQ_PARK_3_EXIT, 1302)        // exit park 3 and go to SNS_YARD_EXIT
ALIAS(SEQ_PARK_4_EXIT, 1303)        // exit park 4 and go to SNS_YARD_EXIT
ALIAS(SEQ_PARK_5_EXIT, 1304)        // exit park 5 and go to SNS_YARD_EXIT
ALIAS(SEQ_PARK_6_EXIT, 1305)        // exit park 6 and go to SNS_YARD_EXIT
*/

ALIAS(SEQ_PARK_7_EXIT, 1306)        // exit park 7 and go to SNS_YARD_EXIT

ALIAS(SEQ_PARK_1_ENTRY, 1310)        // enter park 1 from SNS_YARD_EXIT
ALIAS(SEQ_PARK_2_ENTRY, 1311)        // enter park 2 from SNS_YARD_EXIT
ALIAS(SEQ_PARK_3_ENTRY, 1312)        // enter park 3 from SNS_YARD_EXIT
ALIAS(SEQ_PARK_4_ENTRY, 1313)        // enter park 4 from SNS_YARD_EXIT
ALIAS(SEQ_PARK_5_ENTRY, 1314)        // enter park 5 from SNS_YARD_EXIT
ALIAS(SEQ_PARK_6_ENTRY, 1315)        // enter park 6 from SNS_YARD_EXIT
ALIAS(SEQ_PARK_7_ENTRY, 1316)        // enter park 6 from SNS_YARD_EXIT

ALIAS(SEQ_SHUNTER_ENTRY, 1320)        // enter shunter siding from SNS_YARD_EXIT
ALIAS(SEQ_SHUNTER_EXIT, 1321)        // exit shunter siding go to SNS_YARD_EXIT

ALIAS(SEQ_PARK_ENTRY_SET, 1330)
ALIAS(SEQ_PARK_EXIT_SET, 1331)

  

  
