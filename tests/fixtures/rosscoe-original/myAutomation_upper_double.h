/*
 * myAutomation_upper_double.h
 * 
 */


/*
 * level 0mm aliases
 * 
 * 
 */

/*
 * turnouts
 */

ALIAS(TRN_YARD_ENTRY, 1100)
ALIAS(TRN_LOOP_ENTRY, 1101)
ALIAS(TRN_LOOP_EXIT, 1102)
ALIAS(TRN_LOOP_CROSSOVER, 1103)

ALIAS(TRN_LEFT_IN, 1104)
ALIAS(TRN_LEFT_OUT, 1105)
ALIAS(TRN_LEFT_CROSSOVER, 1106)

ALIAS(TRN_RIGHT_IN, 1107)
ALIAS(TRN_RIGHT_OUT, 1108)
ALIAS(TRN_RIGHT_CROSSOVER, 1109)


/*
 * turnout declarations
 * 
 * these are on the controller on level 0
 */


//TURNOUT(TRN_YARD_ENTRY, 21, 1, "1:Parking yard entry/exit")             //  linear 82
TURNOUTL(TRN_YARD_ENTRY, 82, "1:Parking yard entry/exit")             //  linear 82
//TURNOUT(TRN_LOOP_ENTRY, 21, 2, "1:Lower reversing loop entry")        //  linear 83
//TURNOUT(TRN_LOOP_EXIT, 21, 3, "1:Lower reversing loop exit")          //  linear 84
//CROSSOVER(TRN_LOOP_CROSSOVER, TRN_LOOP_ENTRY, 21, 2, TRN_LOOP_EXIT, 21, 3, "1:Lower reversing loop crossover")  // linear 83 84
CROSSOVERL(TRN_LOOP_CROSSOVER, TRN_LOOP_ENTRY, 83, TRN_LOOP_EXIT, 84, "1:Lower reversing loop crossover")  // linear 83 84

// these are on the controller on level 1

//CROSSOVER(TRN_LEFT_CROSSOVER, TRN_LEFT_IN, 30, 0, TRN_LEFT_OUT, 30, 1, "1:5137 left crossover")                 // linear 117 118
//CROSSOVER(TRN_RIGHT_CROSSOVER, TRN_RIGHT_IN, 30, 2, TRN_RIGHT_OUT, 30, 3, "1:5137 right crossover")             // linear 119 120
CROSSOVERL(TRN_LEFT_CROSSOVER, TRN_LEFT_IN, 117, TRN_LEFT_OUT, 118, "1:5137 left crossover")                 // linear 117 118
CROSSOVERL(TRN_RIGHT_CROSSOVER, TRN_RIGHT_IN, 119, TRN_RIGHT_OUT, 120, "1:5137 right crossover")             // linear 119 120


/*
 * sensors
 */

//ALIAS(SNS_LOOP_MID, 1021)            // middle of reversing loop
ALIAS(SNS_LOOP_ENTRY, 181)             // at TRN_LOOP_ENTRY                          21 PA0        IR 3mm
ALIAS(SNS_LOOP_EXIT, 180)              // at TRN_LOOP_EXIT                           21 PA1        IR 3mm

ALIAS(SNS_PLATFORM_5_ENTRY, 207)       // entry to platform five, up track           22 PB3 11     5146
ALIAS(SNS_PLATFORM_5_STOP, 183)        // exit from platform five, up track          21 PA3        IR 3mm
ALIAS(SNS_PLATFORM_6_ENTRY, 208)       // entry to platform six, down track          22 PB4 12     5146
ALIAS(SNS_PLATFORM_6_STOP, 184)        // exit from platform six, down track         21 PA4        IR 3mm


/*
 * signals
 */

ALIAS(SIG_PLATFORM_FIVE_EXIT, 1040)   // exit from platform five, at tunnel entrance
ALIAS(SIG_PLATFORM_SIX_EXIT, 1041)    // exit from platform six, at bridge underpass     // 1041
ALIAS(SIG_LOOP_ENTRY, 1042)            // at tunnel entry on down track before lower loop

/*
 * signal declarations
 */


//DCC_SIGNAL(SIG_LOOP_ENTRY, 22, 0)
//DCC_SIGNAL(SIG_PLATFORM_FIVE_EXIT, 22, 1)
DCC_SIGNAL(SIG_PLATFORM_SIX_EXIT, 23, 3)                                  // linear 92


/*
 * blocks
 */

ALIAS(BLK_YARD_EXIT, 1)          // SNS_HELIX_TOP to SNS_YARD_EXIT
ALIAS(BLK_LOOP_MID, 2)           // SNS_YARD_EXIT to SNS_LOOP_EXIT
//ALIAS(BLK_LOOP_MAIN, 3)          // SNS_LOOP_MID to SNS_LOOP_EXIT
ALIAS(BLK_LOOP_ENTRY, 4)         // SNS_LOOP_ENTRY to SNS_YARD_EXIT
ALIAS(BLK_LOOP_CROSSOVER, 5)     // TRN_LOOP_CROSSOVER
ALIAS(BLK_MAIN_UP_ONE, 6)        // SNS_LOOP_EXIT to SNS_PLATFORM_5_ENTRY
ALIAS(BLK_RIGHT_CROSSOVER, 7)    // righthand 5137 crossover
ALIAS(BLK_PLATFORM_5, 8)      // platform 5
ALIAS(BLK_LEFT_CROSSOVER, 9)     // lefthand 5137 crossover

ALIAS(BLK_PLATFORM_6, 10)       // platform 6
ALIAS(BLK_MAIN_DOWN_ONE, 11)      // SNS_PLATFORM_6_STOP to SNS_LOOP_ENTRY



/*
 * level 120mm aliases
 * 
 * this is from level 0mm to level 218mm
 * 
 * station platforms are 1 to 4 from inner railbus loop
 * 
 */

/*
 * turnouts
 */


ALIAS(TRN_SPLIT_TWO, 2000)           // where the up and down join in the tunnel.
ALIAS(TRN_SPLIT_THREE, 2001)         // where the up and down split in the tunnel before the bridges

ALIAS(TRN_STATION_ENTRY_LEFT, 2002)  // the 3 way 5214 at the start of the station area left solenoid
ALIAS(TRN_STATION_ENTRY_RIGHT, 2003) // the 3 way 5214 at the start of the station area right solenoid

ALIAS(TRN_STATION_LEFT, 2004)        // at the left of the 5214 and start of the bridges on the main down
ALIAS(TRN_STATION_RIGHT, 2005)       // the 5207 to the right of the 5214 platform 1 and 2

ALIAS(TRN_STATION_EXIT_1, 2006)      // at the end of platform 1
ALIAS(TRN_STATION_EXIT_2, 2007)      // the 5207 at the end of platform 1
ALIAS(TRN_STATION_EXIT_3, 2008)      // the 5207 at the end of platform 3 and the shunter siding          
ALIAS(TRN_STATION_EXIT_4, 2009)      // at the end of plafform 4
ALIAS(TRN_STATION_EXIT_5, 2010)      // after TRN_STATION_EXIT_4 and the railbus siding


/*
 * turnout declarations

 * these are connedted to controller on level 1
 */


//TURNOUT(TRN_SPLIT_TWO, 13, 2, "2:In tunnel")                                // 5202L                                     linear 51
//TURNOUT(TRN_SPLIT_THREE, 13, 3, "2:Before bridges")                         // 5140R                                     linear 52

//TURNOUT(TRN_STATION_ENTRY_LEFT, 10, 0, "2:Station entry left branch")       //  need macro to control the 5214 as it     linear 37
//TURNOUT(TRN_STATION_ENTRY_RIGHT, 10, 1, "2:Station entry right branch")     //  has to be centered before throwing       linear 38

//TURNOUT(TRN_STATION_LEFT, 10, 2, "2:Station platform 4 entry")              // 5202L                                     linear 39
//TURNOUT(TRN_STATION_RIGHT, 10, 3, "2:Station platform 1 entry")             // 5207                                      linear 40
//TURNOUT(TRN_STATION_EXIT_1, 11, 0, "2:Station exit 1")                      //                                           linear 41
//TURNOUT(TRN_STATION_EXIT_2, 11, 1, "2:Station exit 2")                      // 5207 to up track                          linear 42
//TURNOUT(TRN_STATION_EXIT_3, 11, 2, "2:Station exit 3")                      // 5207 from down track and shunter siding   linear 43
//TURNOUT(TRN_STATION_EXIT_4, 11, 3, "2:Station exit 4")                      // to 5207 and up track                      linear 44

//TURNOUT(TRN_STATION_EXIT_5, 31, 0, "2:Station exit 5")                      // from 5207 down track and railbus siding   linear 121


TURNOUTL(TRN_SPLIT_TWO, 51, "2:In tunnel")                                // 5202L                                     linear 51
TURNOUTL(TRN_SPLIT_THREE, 52, "2:Before bridges")                         // 5140R                                     linear 52

TURNOUTL(TRN_STATION_ENTRY_LEFT, 37, "2:Station entry left branch")       //  need macro to control the 5214 as it     linear 37
TURNOUTL(TRN_STATION_ENTRY_RIGHT, 38, "2:Station entry right branch")     //  has to be centered before throwing       linear 38

TURNOUTL(TRN_STATION_LEFT, 39, "2:Station platform 4 entry")              // 5202L                                     linear 39
TURNOUTL(TRN_STATION_RIGHT, 40, "2:Station platform 1 entry")             // 5207                                      linear 40
TURNOUTL(TRN_STATION_EXIT_1, 41, "2:Station exit 1")                      //                                           linear 41
TURNOUTL(TRN_STATION_EXIT_2, 42, "2:Station exit 2")                      // 5207 to up track                          linear 42
TURNOUTL(TRN_STATION_EXIT_3, 43, "2:Station exit 3")                      // 5207 from down track and shunter siding   linear 43
TURNOUTL(TRN_STATION_EXIT_4, 44, "2:Station exit 4")                      // to 5207 and up track                      linear 44

TURNOUTL(TRN_STATION_EXIT_5, 121, "2:Station exit 5")                      // from 5207 down track and railbus siding   linear 121




/*
 * sensors
 */
ALIAS(SNS_MAIN_UP_SIX, 228)           // in tunnel between SNS_PLATFORM_FIVE_EXIT and SNS_MAIN_UP_TWO        24 PA0       IR 3mm
ALIAS(SNS_MAIN_DOWN_SIX, 229)         // in tunnel between SNS_MAIN_DOWN_TWO and SNS_PLATFORM_SIX_ENTRY      24 PA1       IR 3mm
ALIAS(SNS_MAIN_UP_TWO, 185)           // at TRN_SPLIT_TWO on thrown track                                    21 PA5       5146
ALIAS(SNS_MAIN_DOWN_TWO, 194)         // at TRN_SPLIT_TWO on closed track                                    21 PB6       5146
ALIAS(SNS_MAIN_UP_THREE, 190)         // at TRN_SPLIT_THREE on thrown track start of bridge                  21 PB2       IR 3mm
ALIAS(SNS_MAIN_DOWN_THREE, 193)       // at TRN_SPLIT_THREE on closed track end of bridge                    21 PB5       5147
//ALIAS(SNS_MAIN_UP_FOUR, 2024)       // at TRN_STATION_ENTRY end of bridge
//ALIAS(SNS_MAIN_DOWN_FOUR, 2025)     // at TRN_STAION_RIGHT start of bridge



ALIAS(SNS_PLATFORM_1_STOP, 196)    // stopping point for platform 1                       22 PA0  0        IR 3mm
ALIAS(SNS_PLATFORM_2_STOP, 197)    // stopping point for plaftorm 2                       22 PA1  1        IR 3mm
ALIAS(SNS_PLATFORM_3_STOP, 198)    // stopping point for platform 3                       22 PA2  2        IR 3mm
ALIAS(SNS_PLATFORM_4_STOP, 199)    // stopping point for platform 4                       22 PA3  3        IR 3mm



ALIAS(SNS_PLATFORM_1_ENTRY, 200)   // entry to platform 1 before SNS_PLATFORM_1_STOP      22 PA4  4        IR 3mm
ALIAS(SNS_PLATFORM_2_ENTRY, 201)   // entry to platform 2 before SNS_PLATFORM_2_STOP      22 PA5  5        IR 3mm
ALIAS(SNS_PLATFORM_3_ENTRY, 202)   // entry to platform 3 before SNS_PLATFORM_3_STOP      22 PA6  6        IR 3mm
ALIAS(SNS_PLATFORM_4_ENTRY, 206)   // entry to platform 4 before SNS_PLATFORM_4_STOP      22 PB2 10        IR 3mm


ALIAS(SNS_RAILBUS_STATION_STOP, 204)     // stop point of the railbus station             22 PB0  8        IR 3mm
ALIAS(SNS_RAILBUS_STATION_ENTRY, 205)    // entry point of the railbus station            22 PB1  9        IR 3mm

ALIAS(SNS_RAILBUS_SHED_ENTRY, 220)       // entry point for the reailbus shed             23 PB0  0        IR 3mm
ALIAS(SNS_RAILBUS_SHED_STOP, 221)        // entry point for the reailbus shed             23 PB1  1        IR 3mm

ALIAS(SNS_RAILBUS_LOOP_MID, 182)         // mid point of the railbus loop                 21 PA2           IR 3mm

ALIAS(SNS_COAL_ENTRY, 210)         // entry to the shunter yard                           22 PB6  14       IR 3mm
ALIAS(SNS_COAL_STOP, 240)          // stop in the shunter yard                            24 PB4  12       IR 3mm

/*
 * signals
 */


ALIAS(SIG_PLATFORM_ONE_EXIT, 2040)  // exit from platform 1
ALIAS(SIG_PLATFORM_TWO_EXIT, 2041)  
ALIAS(SIG_PLATFORM_THREE_EXIT, 2042)
ALIAS(SIG_PLATFORM_FOUR_EXIT, 2043)

ALIAS(SIG_STATION_ENTRY, 2044)
ALIAS(SIG_COAL_ENTRY, 2045)

/*
 * signal declarations
 */

DCC_SIGNAL(SIG_STATION_ENTRY, 31, 1)                                                // linear 122
DCC_SIGNAL(SIG_COAL_ENTRY, 40, 1)                                                   // linear 158 

/*
 * uncoupler aliases
 */
ALIAS(UNC_COAL, 2050)

/*
 * uncoupler declarations
 * use THROW to activate  there is no CLOSE connection only a single solenoid
 */
//TURNOUT(UNC_COAL, 31, 3, "2:Z Coal uncoupler")                                      // linear 124
TURNOUTL(UNC_COAL, 124, "2:Z Coal uncoupler")                                      // linear 124

/*
 * blocks
 */

ALIAS(BLK_MAIN_UP_TWO, 20)          // from SNS_MAIN_UP_ONE to SNS_MAIN_UP_TWO
ALIAS(BLK_MAIN_DOWN_TWO, 21)        // from SNS_MAIN_DOWN_TWO to SNS_MAIN_DOWN_ONE
ALIAS(BLK_JUNCTION_TWO, 22)         // TRN_SPLIT_TWO and TRN_SPLIT_THREE
ALIAS(BLK_MAIN_UP_THREE, 23)        // TRN_SPLIT_THREE to TRN_STATION_ENTRY across inner bridge
ALIAS(BLK_MAIN_DOWN_THREE, 24)      // TRN_STATION_RIGHT to TRN_SPLIT_THREE across outer bridge
ALIAS(BLK_MAIN_UP_SIX, 25)          // from SNS_PLATFORM_FIVE_EXIT to SNS_MAIN_UP_ONE
ALIAS(BLK_MAIN_DOWN_SIX, 26)        // from SNS_MAIN_DOWN_ONE to SNS_PLATFORM_SIX_ENTRY

ALIAS(BLK_PLATFORM_1, 27)   // platform 1 on railbus loop
ALIAS(BLK_PLATFORM_2, 28)   // platform 2
ALIAS(BLK_PLATFORM_3, 29)   // platform 3
ALIAS(BLK_PLATFORM_4, 30)   // platform 4

ALIAS(BLK_RAILBUS_LOOP_LEFT, 31)    // the inner railbus loop
ALIAS(BLK_RAILBUS_LOOP_MID, 32)     // the inner railbus loop
ALIAS(BLK_RAILBUS_LOOP_STATION, 33) // the inner railbus loop station
ALIAS(BLK_STATION_RIGHT, 34)        // the 5207 on the railbus loop

ALIAS(BLK_RAILBUS_SHED, 35)         // the railbus shed

ALIAS(BLK_STATION_EXIT_2, 36)       // 5207 at platform 3 left
ALIAS(BLK_STATION_EXIT_3, 37)       // 5207 at platform 3 left to railbus shed

ALIAS(BLK_SHUNTER, 38)              // the shunter siding

/*
 * level 218mm aliases
 */

/*
 * turnouts
 */

ALIAS(TRN_SIDING_ONE, 3000)     // from main track to yard
ALIAS(TRN_SIDING_TWO, 3001)     // to crane and coal loader
ALIAS(TRN_SIDING_THREE, 3002)   // engine shed division
ALIAS(TRN_SIDING_FOUR, 3003)    // junk yard from engine shed
ALIAS(TRN_GOODS_ENTRY, 3004)    // from main track to goods station
ALIAS(TRN_GOODS_EXIT, 3005)     // to main track from goods station


/*
 * turnout declarations
 */

//TURNOUT(TRN_SIDING_ONE, 12, 1, "3:Yard")                          // linear 46
//TURNOUT(TRN_SIDING_TWO, 12, 2, "3:Crane yard")                    // linear 47
//TURNOUT(TRN_SIDING_THREE, 12, 3, "3:Engine shed division")        // linear 48
//TURNOUT(TRN_SIDING_FOUR, 12, 0, "3:Junk yard")                    // linear 45

//TURNOUT(TRN_GOODS_EXIT, 13, 0, "3:Exit goods station")           // linear 49
//TURNOUT(TRN_GOODS_ENTRY, 13, 1, "3:Enter goods station")           // linear 50


TURNOUTL(TRN_SIDING_ONE, 46, "3:Yard")                          // linear 46
TURNOUTL(TRN_SIDING_TWO, 47, "3:Crane yard")                    // linear 47
TURNOUTL(TRN_SIDING_THREE, 48, "3:Engine shed division")        // linear 48
TURNOUTL(TRN_SIDING_FOUR, 45, "3:Junk yard")                    // linear 45

TURNOUTL(TRN_GOODS_EXIT, 49, "3:Exit goods station")           // linear 49
TURNOUTL(TRN_GOODS_ENTRY, 50, "3:Enter goods station")           // linear 50




/*
 * sensors
 * numbers for these need to be confirmed with MCP23017 vpin connections
 */

ALIAS(SNS_MAIN_UP_FOUR, 186)        // at TRN_YARD_ENTRY                        // 21 PA6   5146
// ALIAS(SNS_MAIN_DOWN_FOUR, 321)      // after TRN_GOODS_EXIT

ALIAS(SNS_MAIN_UP_FIVE, 188)        // at TRN_GOODS_ENTRY                       // 21 PB0   IR 3MM
ALIAS(SNS_MAIN_DOWN_FIVE, 189)      // at TRN_GOODS_EXIT                        // 21 PB1   IR 3MM

ALIAS(SNS_GOODS_ENTRY, 192)         // entry to the goods station               // 21 PB4   IR 3MM
ALIAS(SNS_GOODS_STOP, 191)          // stop point for the goods station         // 21 PB3   IR 3MM

ALIAS(SNS_CRANE_ENTRY, 230)         // crane yard entry                         // 24 PA2   IR 3MM
ALIAS(SNS_CRANE_STOP, 231)          // crane yard stop point                    // 24 PA3   IR 3MM

ALIAS(SNS_SHED_ENTRY, 232)          // engine shed yard entry                   // 24 PA4   IR 3MM
ALIAS(SNS_SHED_ENTRY_1, 233)        // engine shed left entry                   // 24 PA5   IR 3MM
ALIAS(SNS_SHED_ENTRY_2, 234)        // engine shed right entry                  // 24 PA6   IR 3MM
ALIAS(SNS_SHED_STOP_1, 236)         // engine shed left stop point              // 24 PB0   IR 3MM
ALIAS(SNS_SHED_STOP_2, 237)         // engine shed right stop point             // 24 PB1   IR 3MM

ALIAS(SNS_JUNK_YARD_ENTRY, 238)     // junk yard entry                          // 24 PB2   IR 3MM
ALIAS(SNS_JUNK_YARD_STOP, 239)      // junk yard stop                           // 24 PB3   IR 3MM


/*
 * signals
 */

ALIAS(SIG_GOODS_STATION_EXIT, 3060)
ALIAS(SIG_YARD_ENTRY, 3061)


/*
 * signal declarations
 */

DCC_SIGNAL(SIG_GOODS_STATION_EXIT, 31, 2)             // linear 123
DCC_SIGNAL(SIG_YARD_ENTRY, 40, 0)                     // linear 157



/*
 * blocks
 */

ALIAS(BLK_MAIN_UP_FOUR, 50)       // from TRN_STATION_EXIT_3 to TRN_YARD
ALIAS(BLK_MAIN_DOWN_FOUR, 51)     // from TRN_GOODS_STATION_EXIT to TRN_STATION_EXIT_2

ALIAS(BLK_YARD_ENTRY, 52)         // the yard turnout

ALIAS(BLK_MAIN_UP_FIVE, 53)       // from yard entry to goods entry
ALIAS(BLK_MAIN_DOWN_FIVE, 54)     // from goods entry to goods exit

ALIAS(BLK_GOODS_STATION, 55)      // the goods station

ALIAS(BLK_CRANE_YARD, 56)         // the yard where the crane and coal loader are
ALIAS(BLK_ENGINE_SHED_LEFT, 57)
ALIAS(BLK_ENGINE_SHED_RIGHT, 58)
ALIAS(BLK_JUNK_YARD, 59)



/*
* lighting aliases
*/

ALIAS(LGT_GOODS_YARD, 235)        // the goods yard lights  RESET to turn on                       24 PA 7   
ALIAS(LGT_CRANE_YARD, 227)        // the goods yard lights  RESET to turn on                       23 PB 7






/*
 * sequence aliases
 * 
 */
ALIAS(SEQ_CHECK_MAIN_UP_TWO, 4000)


ALIAS(SEQ_YARD_ENTRY_PLATFORM_5, 4004)       // from yard exit to platform 5

ALIAS(SEQ_YARD_ENTRY_PLATFORM_5_6, 4006)     // from yard exit to platform 5 or 6

/*
ALIAS(SEQ_YARD_TO_PLATFORM_1, 4000)          // from yard exit to platform 1
ALIAS(SEQ_YARD_TO_PLATFORM_2, 4001)          // from yard exit to platform 2
ALIAS(SEQ_YARD_TO_PLATFORM_3, 4002)          // from yard exit to platform 3
ALIAS(SEQ_YARD_TO_PLATFORM_4, 4003)          // from yard exit to platform 4
ALIAS(SEQ_YARD_TO_PLATFORM_6, 4005)          // from yard exit to platform 6
*/

ALIAS(SEQ_PLATFORM_1_TO_PLATFORM_1, 4100)    // the railbus loop platfrom 1 to platform 1
ALIAS(SEQ_RAILBUS_STATION_TO_RAILBUS_STATION, 4101) // the railbus loop railbus station to railbus station
ALIAS(SEQ_PLATFORM_1_TO_RAILBUS_SHED, 4102)         // move the railbus at platform 1 to the railbus shed
ALIAS(SEQ_RAILBUS_SHED_TO_PLATFORM_1, 4103)         // move the railbus in the railbus shed to platform 1


/*
ALIAS(SEQ_PLATFORM_2_PLATFORM_4, 4110)    // leave platfrom 2 via upper reversing loop to platform 4
*/
ALIAS(SEQ_PLATFORM_2_PLATFORM_2, 4110)    // leave platfrom 2 to platform 2 via all upper
ALIAS(SEQ_PLATFORM_2_PLATFORM_6, 4126)    // leave platfrom 2 to platform 6

ALIAS(SEQ_PLATFORM_3_PLATFORM_4, 4134)    // leave platform 3 via upper reversing loop to platform 4
ALIAS(SEQ_PLATFORM_3_PLATFORM_5, 4135)    // leave platform 3 to platform 5
ALIAS(SEQ_PLATFORM_3_PLATFORM_6, 4136)    // leave platform 3 to platform 6


ALIAS(SEQ_PLATFORM_4_PLATFORM_2, 4142)    // leave platform 4 via upper reversing loop to platform 2
ALIAS(SEQ_PLATFORM_4_PLATFORM_3, 4143)    // leave platform 4 via upper reversing loop to platform 3
ALIAS(SEQ_PLATFORM_4_PLATFORM_6, 4146)    // leave platform 4 to platform 6


ALIAS(SEQ_PLATFORM_5_PLATFORM_3, 4153)    // leave platfrom 5 to platform 3 via bridge
ALIAS(SEQ_PLATFORM_5_PLATFORM_4, 4154)    // leave platfrom 5 to platform 3 via bridge

/*
ALIAS(SEQ_PLATFORM_1_TO_YARD, 4200)          // from platform 1 to yard entry
ALIAS(SEQ_PLATFORM_2_TO_YARD, 4201)          // from platform 2 to yard entry
ALIAS(SEQ_PLATFORM_3_TO_YARD, 4202)          // from platform 3 to yard entry
ALIAS(SEQ_PLATFORM_4_TO_YARD, 4203)          // from platform 4 to yard entry
ALIAS(SEQ_PLATFORM_5_TO_YARD, 4204)          // from platform 5 to yard entry
*/

ALIAS(SEQ_PLATFORM_6_YARD_EXIT, 4205)          // from platform 6 to yard entry

ALIAS(SEQ_TO_GOODS_STATION, 4206)              // from mainline to goods station and on to mainline

/*
 * automation aliases
 */



ALIAS(ATM_AROUND_THE_TOP, 3000)                // from yard entry to yard entry
ALIAS(ATM_AROUND_THE_TOP_2, 3001)              // from yard entry to yard entry alternate via P4 to P3

ALIAS(ATM_PLATFORM_2_PLATFORM_2, 3002)         // from platform 2 to platform 6 to platform 4 to platform 2

/*
 * route aliases
 */

ALIAS(FREE_UPPER, 3010)                      // free all upper reserves


/*
 * aliases for latching and unlatching  must be between 0-255
 */

ALIAS(LTCH_RAILBUS_HALT, 80)                // latch railbus halt
ALIAS(LTCH_RB_1, 81)                        // latch railbus count 1
ALIAS(LTCH_RB_2, 82)                        // latch railbus count 2
ALIAS(LTCH_RB_3, 83)                        // latch railbus count 3
ALIAS(LTCH_RB_4, 84)                        // latch railbus count 4
ALIAS(LTCH_RB_5, 85)                        // latch railbus count 5
ALIAS(LTCH_RB_6, 86)                        // latch railbus count 6
ALIAS(LTCH_RB_7, 87)                        // latch railbus count 7
ALIAS(LTCH_RB_8, 88)                        // latch railbus count 8
ALIAS(LTCH_RB_9, 89)                        // latch railbus count 9



ALIAS(LTCH_PARK, 90)                        // latch send loco to parking

ALIAS(LTCH_AROUND, 91)                      // latch continue ATM_AROUND_THE_TOP

ALIAS(LTCH_AROUND_2, 92)                    // latch continue ATM_AROUND_THE_TOP_2

ALIAS(LTCH_P2_P2, 93)                       // latch to continue platform 2 to platform 2
ALIAS(LTCH_P2_TO_P2, 94)                    // latch to show platform 2 to platform 2 is running

ALIAS(LTCH_DEBUG, 95)                       // latch to print debug messages

ALIAS(LTCH_TESTING, 96)                     // latch for testing

ALIAS(LTCH_PLATFORM_6, 97)                  // latch to show platform 6 used to bypass platform 5

ALIAS(LTCH_DO_GOODS_STATION, 98)            // latch to make train go to goods station  random still works

ALIAS(LTCH_END_COAL_CYCLE, 99)              // latch to stop the coal devivery cycle
  
  
