 /*
 * myAutomation_Startup.h
 */

/*
 * put EX-Rail start up commands here.
 */


//AUTOSTART
SEQUENCE(SEQ_CHECK_MAIN_UP_TWO)
  IF(SNS_MAIN_UP_TWO)
    PRINT("if SNS_MAIN_UP_TWO")
    THROW(TRN_SPLIT_TWO)
    CLOSE(TRN_SPLIT_THREE)
  ENDIF
  FOLLOW(SEQ_CHECK_MAIN_UP_TWO)
  DONE




/*
 * setup level 0 turnouts on startup
 */

SEQUENCE(990)
AUTOSTART
RESERVE(BLK_PARK_1)
RESERVE(BLK_PARK_2)
RESERVE(BLK_PARK_2_SHORT)
RESERVE(BLK_PARK_3)
RESERVE(BLK_PARK_4)
RESERVE(BLK_PARK_5)
RESERVE(BLK_PARK_6)
RESERVE(BLK_PARK_7)


DELAY(5000)                           // this is to allow all the decoders to startup

/*
 * setup level 0 turnouts on startup
 */

CALL(SEQ_PARK_ENTRY_SET)
CALL(SEQ_PARK_EXIT_SET)


/*
 * setup level 1 turnouts on startup
 */
THROW(TRN_YARD_ENTRY)
CLOSE(TRN_LOOP_CROSSOVER)
CLOSE(TRN_LEFT_CROSSOVER)
CLOSE(TRN_RIGHT_CROSSOVER)


/*
 * setup level 1 signals on startup
 */
RED(SIG_PLATFORM_SIX_EXIT)


/*
 * setup level 2 turnouts on startup
 */

CLOSE(TRN_SPLIT_TWO)
CLOSE(TRN_SPLIT_THREE)

CLOSE_CENTER(TRN_STATION_ENTRY_LEFT, TRN_STATION_ENTRY_RIGHT)
CLOSE(TRN_STATION_LEFT)
THROW(TRN_STATION_RIGHT)

CLOSE(TRN_STATION_EXIT_1)
THROW(TRN_STATION_EXIT_2)
CLOSE(TRN_STATION_EXIT_3)
CLOSE(TRN_STATION_EXIT_4)
THROW(TRN_STATION_EXIT_5)

/*
 * setup level2 signals on startup
 */

RED(SIG_STATION_ENTRY)

/*
 * setup level 3 turnouts on startup
 */

CLOSE(TRN_SIDING_ONE)
THROW(TRN_SIDING_TWO)
CLOSE(TRN_SIDING_THREE)
THROW(TRN_SIDING_FOUR)
CLOSE(TRN_GOODS_ENTRY)
CLOSE(TRN_GOODS_EXIT)

/*
* setup level 3 signals on startup
*/

RED(SIG_GOODS_STATION_EXIT)

/*
 * set latches
 */

UNLATCH(LTCH_RAILBUS_HALT)                // latch railbus halt

UNLATCH(LTCH_PARK)                        // latch send loco to parking

UNLATCH(LTCH_AROUND_2)                    // latch continue ATM_AROUND_THE_TOP_2

UNLATCH(LTCH_P2_P2)                       // latch to continue platform 2 to platform 2


UNLATCH(LTCH_PLATFORM_6)                  // latch to show platform 6 used to bypass platform 5

UNLATCH(LTCH_DEBUG)                       // latch to print debug messages

UNLATCH(LTCH_TESTING)                    // latch for testing



DONE



