/*
 * myMacros.h
 */

/*
 * Macros to handle three way turnouts has THROW_LEFT, THROW_RIGHT, CLOSE_CENTER
 * All of these need both ids for the three way
 * 
 * TODO:  Make sure these work
 *        Marklin 5214 needs to centre both sides before throwing left or right
 */

  #define DELAY_SWITCH 250

  #define CLOSE_CENTER(id_left, id_right)\
  CLOSE(id_left)\
  CLOSE(id_right)\
  CLOSE(id_left)\
  DELAY(DELAY_SWITCH)

  #define THROW_LEFT(id_left, id_right)\
  CLOSE_CENTER(id_left, id_right)\
  THROW(id_left)\
  DELAY(DELAY_SWITCH)

  #define THROW_RIGHT(id_left, id_right)\
  CLOSE_CENTER(id_left, id_right)\
  THROW(id_right)\
  DELAY(DELAY_SWITCH)

// Macro to control two turnouts as one for crossovers.

  #define CROSSOVER(id, id1, addr1, addr_sub1, id2, addr2, addr_sub2, desc)\
  VIRTUAL_TURNOUT(id, desc)\
  TURNOUT(id1, addr1, addr_sub1, HIDDEN)\
  TURNOUT(id2, addr2, addr_sub2, HIDDEN)\
  ONCLOSE(id)\
    CLOSE(id1)\
    DELAY(DELAY_SWITCH)\
    CLOSE(id2)\
    DELAY(DELAY_SWITCH)\
    DONE\
  ONTHROW(id)\
    THROW(id1)\
    DELAY(DELAY_SWITCH)\
    THROW(id2)\
    DELAY(DELAY_SWITCH)\
    DONE


// Macro to control two turnouts as one for crossovers linear addresses

#define CROSSOVERL(id, id1, addr1, id2, addr2, desc)\
  VIRTUAL_TURNOUT(id, desc)\
  TURNOUTL(id1, addr1, HIDDEN)\
  TURNOUTL(id2, addr2, HIDDEN)\
  ONCLOSE(id)\
    CLOSE(id1)\
    DELAY(DELAY_SWITCH)\
    CLOSE(id2)\
    DELAY(DELAY_SWITCH)\
    DONE\
  ONTHROW(id)\
    THROW(id1)\
    DELAY(DELAY_SWITCH)\
    THROW(id2)\
    DELAY(DELAY_SWITCH)\
    DONE


//Macro to control solenoid turnouts
// https://discord.com/channels/713189617066836079/873794422993727568/1004923697586511954
// not used with DCC Turnout controller

// This is for 3 aspect DCC signal.
// The "slow" (HP2) is only active with the "clear" (HP1)
// So need to deactivate it when set to "clear" (HP1) or "halt" (HP0)

#define DCC_SIGNAL_THREE(id_main, addr_main, addr_main_sub, addr_amber, addr_amber_sub)\
  DCC_SIGNAL(id_main, addr_main, addr_main_sub)\
  ONAMBER(id_main)\
    ACTIVATE(addr_amber, addr_amber_sub)\
    LATCH(id_main/10)\
    DONE\
  ONRED(id_main)\
    UNLATCH(id_main/10)\
    DONE\
  ONGREEN(id_main)\
    IF(id_main/10)\
      RED(id_main)\
      DELAY(1000)\
      GREEN(id_main)\
      PRINT("Green done")\
      ENDIF\
  DONE




/*
DELAY(1000)\

ONAMBER(27) LATCH(27) DONE

ONRED(27) UNLATCH(27) DONE

ONGREEN(27) 
IF(27)
   RED(27) 
   DELAY(2000)
   GREEN(27)
   ENDIF
DONE
*/

/*
  ONRED(id)\
    DEACTIVATE(addr_amber, addr_amber_sub)\
  DONE\
  ONGREEN(id)\
    DEACTIVATE(addr_amber, addr_amber_sub)\
  DONE\
  ONAMBER(id)\
    ACTIVATE(addr_main, addr_main_sub)\
    ACTIVATE(addr_amber, addr_amber_sub)\
  DONE
*/

/*
#ifdef TESTING_SOLENOID_TURNOUTS
#define PULSE 50
#define KATOTURNOUT(t, p1, p2, desc, ali) \
PIN_TURNOUT(t, 0, desc) \
ALIAS(ali, t) \
DONE \
ONCLOSE(t) \
SET(p1) \
RESET(p2)DELAY(PULSE)SET(p2) \
DONE \
ONTHROW(t) \
RESET(p1) \
SET(p2)DELAY(PULSE)RESET(p2) \
DONE 
#endif
*/


  
