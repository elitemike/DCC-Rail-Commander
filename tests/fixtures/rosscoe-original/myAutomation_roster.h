/*
 * myAutomationRoster.h
 * 
 * Put loco roster items and aliases here
 * 
 */

/*
 * loco aliases                 // CV17 CV18
 */

ALIAS(LOC_3000, 3000)           // 203 184
ALIAS(LOC_3001, 3001)           // 203 185
ALIAS(LOC_3005, 3005)           // 203 189
ALIAS(LOC_3016, 3016)           // 203 200
ALIAS(LOC_3022, 3022)           // 203 206
ALIAS(LOC_3048_1, 3048)         // 203 232
ALIAS(LOC_3048_2, 4048)         // 207 208
ALIAS(LOC_3048_CONSIST, 17)     // can't be a long address
ALIAS(LOC_3060, 3060)           // 203 244
ALIAS(LOC_3065, 3065)           // 203 249
ALIAS(LOC_3084, 3084)           // 204 12
ALIAS(LOC_3089, 3089)           // 204 17
ALIAS(LOC_3102, 3102)           // 204 30
ALIAS(LOC_3356, 3356)           // 205 28
ALIAS(LOC_3349, 3349)           // 205 28
ALIAS(LOC_3629, 3629)           // 206 99
ALIAS(LOC_3683, 3683)           // 206 99

ALIAS(LOC_3005_COPPER, 4005)    // 207 165

ALIAS(LOC_37754, 7754)          // 222 74
ALIAS(LOC_37973, 7973)          // 223 37
ALIAS(LOC_37994, 7994)          // 223 58


ALIAS(LOC_HAG_191, 191)         // 192 191


ROSTER( LOC_3000, "Marklin 3000 89005", "Light///////////")                     // Address 3000, Marklin 3000 tank loco
ROSTER( LOC_3001, "Junk Yard Dog", "Light///////////")                          // Address 3001, Marklin 3001 “Junk Yard Dog”  Lokpilot 4
ROSTER( LOC_3005, "Marklin 3005 23014", "Light///////////")                     // Address 3005, Marklin 3005 steam loco
ROSTER( LOC_3005_COPPER, "Marklin 3005 Copper", "Light/Smoke/ /Shunting/Momentum/////////")         // Address 4005, Marklin 3005 steam loco with smoke generator Lokpilot 4
ROSTER( LOC_3016, "Marklin 3016 Railcar", "Light///////////")                   // Address 3016, Marklin 3016 Railcar with trailer
ROSTER( LOC_3022, "Marklin 3022 ", "Light//////Shunting/////")                        // Address 3022, Marklin 3022 Electic loco
ROSTER( LOC_3048_1, "Marklin 3048 1", "Light///////////")                       // Address 3048, Marklin 3048 steam loco
ROSTER( LOC_3048_2, "Marklin 3048 2", "Light///////////")                       // Address 4048, Marklin 3048 steam loco
ROSTER( LOC_3048_CONSIST, "Marklin 3048 Consist", "/Light///////////")          // Address 17, 2 x Marklin 3048 steam locos for consist
ROSTER( LOC_3084, "Marklin 3084 ", "Light//Whistle/Bells///Shunting//Sound///") // Address 3084, Marklin 3084 steam loco
ROSTER( LOC_3060, "Marklin 3060 337", "Light/Mars Light//////////")             // Address 3060, Marklin 3060 Diesel EMD F7 loco
ROSTER( LOC_3065, "Marklin 3065", "Light///UC Rear/UC Front///////")            // Address 3065, Marklin 3065 Diesel shunter
ROSTER( LOC_3089, "Marklin 3089 ", "Light/ / /Shunting/Momentum////////")       // Address 3089, Marklin 3089 Streamlined steam loco  Lokpilot 5
ROSTER( LOC_3102, "Marklin 3102 ", "Light/Smoke/Horn Long/*Horn Short///Shunting//Sound//////")  // Address 3102, Marklin 3102 steam loco  Loksound 5
ROSTER( LOC_3349, "Marklin 3349 ", "Light/Bell/Horn////Shunting/Momentum/Sound/////")       // Address 3349, Electro-Motive F7 A-B-A loco  Loksound 5
ROSTER( LOC_3356, "Marklin 3356 13303", "Light/ / /Shunting/Momentum///////")   // Address 3356, Marklin 3356 Crocodile  Lokpilot 5
ROSTER( LOC_3629, "Marklin 3629", "Light////////////")                          // Address 3629, Marklin 3629 Electric goods railcar  LaisDCC 21mtc
ROSTER( LOC_3683, "Marklin 3683", "Light/ / /Shunting/Momentum////////")        // Address 3683, Marklin 3683 Electric goods railcar  Lokpilot 5
ROSTER( LOC_37754, "Marklin 37754 ", "Light/Cab Light/Sound/*Horn/Momentum/Interior Light/Marker Light/*Horn/Coupler/Brake Squeal/Fan/*Whistle/*Annoucement/Compressor/Rail Joints/*Conductor//////Air Horn////////////") // Address 7754, Marklin 37754 heavy electric ore  Marklin mSD3
ROSTER( LOC_37973, "Marklin 37973 ", "/Sound/Whistle/Slow Bell/Injector/Preheating Cylinders/Shunting/Smoke/Coal Shovelling/Blow Out/Radio (level crossing)/Radio (detector)/Air Pump/////////////////////") // Address 7973, Marklin 37973 Mikado  Lokpilot 4 M4
ROSTER( LOC_37994, "Marklin 37994 ", "Light/Bell/Whistle/Cab Light///Shunting/Momentum/Sound/////////////Air Horn////////////") // Address 7994, Marklin 37994 big boy  Lokpilot 5

ROSTER( LOC_HAG_191, "HAG 191 Railbus ", "Light/Interior Light/ /Shunting/Momentum///////")     // Address 191, HAG 191 Railbus 



//ROSTER( 99, "LaisDCC Decoder Tester", "Light/F1/F2/F3/F4///////")    // Address 99, LaisDCC decoder tester


ALIAS(SEQ_SET_LOCO_SPEED_MAX, 9990)
ALIAS(SEQ_SET_LOCO_YARD_EXIT_SPEED, 9991)
ALIAS(SEQ_SET_LOCO_YARD_ENTRY_SPEED, 9992)
ALIAS(SEQ_LOCO_ON_FUNCTIONS, 9993)
ALIAS(SEQ_LOCO_OFF_FUNCTIONS, 9994)



/*
 * A sequence to set speeds for different locos.
 * It's here so that I can see the loco aliases
 */


SEQUENCE(SEQ_SET_LOCO_SPEED_MAX)
  IFLOCO(LOC_3102)
    FWD(72)
  ELSE
    IFLOCO(LOC_3084)
      FWD(60)
    ELSE
      IFLOCO(LOC_3683)
        FWD(126)
      ELSE
        IFLOCO(LOC_3022)
          FWD(29)
        ELSE
          IFLOCO(LOC_3048_1)
            FWD(31)
          ELSE
            IFLOCO(LOC_3048_2)
              FWD(31)
            ELSE
              IFLOCO(LOC_3048_CONSIST)
                FWD(25)
              ELSE
                IFLOCO(LOC_3060)
                  FWD(26)
                ELSE
                  IFLOCO(LOC_3089)
                    FWD(73)
                  ELSE
                    IFLOCO(LOC_3356)
                      FWD(73)
                    ELSE
                      IFLOCO(LOC_3349)
                        FWD(60)
                      ELSE
                        FWD(20)                          // insert new locos above this and make this the last else and put a new ENDIF after this
                      ENDIF
                    ENDIF
                  ENDIF
                ENDIF
              ENDIF
            ENDIF
          ENDIF
        ENDIF
      ENDIF
    ENDIF
  ENDIF
/*
  IFLOCO(LOC_3000)
  ENDIF
  IFLOCO(LOC_3001)
  ENDIF
  IFLOCO(LOC_3005)
  ENDIF
  IFLOCO(LOC_3005_COPPER)
  ENDIF
  IFLOCO(LOC_37994)
  ENDIF

  IFLOCO(LOC_3016)
  ENDIF
  IFLOCO(LOC_HAG_191)
  ENDIF
*/
RETURN




/*
 * set loco speed to exit the parking yard
 */

SEQUENCE(SEQ_SET_LOCO_YARD_EXIT_SPEED)
    FWD(20)
  IFLOCO(LOC_3102)
    FWD(73)
  ENDIF
  IFLOCO(LOC_3084)
    FWD(50)
  ENDIF
  IFLOCO(LOC_3683)
    FWD(126)
  ENDIF
/*
  IFLOCO(LOC_3000)
  ENDIF
  IFLOCO(LOC_3001)
  ENDIF
  IFLOCO(LOC_3356)
  ENDIF
  IFLOCO(LOC_3005)
  ENDIF
  IFLOCO(LOC_3016)
  ENDIF
*/
  IFLOCO(LOC_3022)
    FWD(26)
  ENDIF
  IFLOCO(LOC_3048_1)
    FWD(31)
  ENDIF
  IFLOCO(LOC_3048_2)
    FWD(31)
  ENDIF

  IFLOCO(LOC_3048_CONSIST)
    FWD(31)
  ENDIF

  IFLOCO(LOC_3060)
    FWD(26)
  ENDIF

  IFLOCO(LOC_3349)
    FWD(50)
  ENDIF
/*
  IFLOCO(LOC_3089)
    FWD(73)
  ENDIF
*/
/*
  IFLOCO(LOC_3005_COPPER)
  ENDIF

  IFLOCO(LOC_37994)
  ENDIF

  IFLOCO(LOC_HAG_191)
  ENDIF
*/

RETURN

/*
 * set the loco speed for entry the parking yard
 */

SEQUENCE(SEQ_SET_LOCO_YARD_ENTRY_SPEED)
  IFLOCO(LOC_3102)
    FWD(61)
  ENDIF
  IFLOCO(LOC_3084)
    FWD(51)
  ENDIF
  IFLOCO(LOC_3683)
    FWD(101)
  ENDIF
/*
  IFLOCO(LOC_3000)
  ENDIF
  IFLOCO(LOC_3001)
  ENDIF
  IFLOCO(LOC_3356)
  ENDIF
  IFLOCO(LOC_3005)
  ENDIF
  IFLOCO(LOC_3016)
  ENDIF
*/
  IFLOCO(LOC_3022)
    FWD(21)
  ENDIF
  IFLOCO(LOC_3048_1)
    FWD(25)
  ENDIF
  IFLOCO(LOC_3048_2)
    FWD(25)
  ENDIF
    
  IFLOCO(LOC_3048_CONSIST)
    FWD(25)
  ENDIF

  IFLOCO(LOC_3060)
    FWD(21)
  ENDIF

  IFLOCO(LOC_3349)
    FWD(40)
  ENDIF

/*
  IFLOCO(LOC_3089)
    FWD(73)
  ENDIF
*/
/*
  IFLOCO(LOC_3005_COPPER)
  ENDIF

  IFLOCO(LOC_37994)
  ENDIF

  IFLOCO(LOC_HAG_191)
  ENDIF
*/

RETURN





/*
 * put loco functions here that you want to turn on at the start of an automation or route
 */


SEQUENCE(SEQ_LOCO_ON_FUNCTIONS)
  FON(0)                         // always turn on the light

  IFLOCO(LOC_3102)
//    FON(1)                       // smoke generator
    FON(8)                       // sound on
  ENDIF

  IFLOCO(LOC_3084)
    FON(6)                      // shunting on
    FOFF(6)                     // shunting off
    FON(8)                      // sound on
  ENDIF
  
  IFLOCO(LOC_3683)
  ENDIF
  IFLOCO(LOC_3000)
  ENDIF
  IFLOCO(LOC_3001)
  ENDIF
  IFLOCO(LOC_3356)
  ENDIF
  IFLOCO(LOC_3005)
  ENDIF
  IFLOCO(LOC_3016)
  ENDIF
  IFLOCO(LOC_3022)
    FON(6)
    FOFF(6)
  ENDIF
  IFLOCO(LOC_3048_1)
  ENDIF
  IFLOCO(LOC_3048_2)
  ENDIF
  IFLOCO(LOC_3048_CONSIST)
//    SETLOCO(LOC_3048_2)
//    FON(0)
//    SETLOCO(LOC_3048_CONSIST)
  ENDIF
  IFLOCO(LOC_3060)
    FON(1)
  ENDIF
  IFLOCO(LOC_3349)
    FON(8)            // sound on
  ENDIF
  IFLOCO(LOC_3089)
  ENDIF
  IFLOCO(LOC_3683)
  ENDIF

  IFLOCO(LOC_3005_COPPER)
  ENDIF

  IFLOCO(LOC_37973)
    FON(1)               // sound on
  ENDIF

  IFLOCO(LOC_37994)
    FON(8)               // sound on
  ENDIF

  IFLOCO(LOC_HAG_191)
  ENDIF

RETURN

/*
 * put loco functions here that you want to turn off at the end of an automation or route
 */

SEQUENCE(SEQ_LOCO_OFF_FUNCTIONS)

  FOFF(0)
 
  IFLOCO(LOC_3102)
    FOFF(1)
    DELAY(2000)
    FOFF(8)              // sound
    FOFF(6)              // shunting
  ENDIF
  IFLOCO(LOC_3084)
    FOFF(1)
    DELAY(2000)
    FOFF(8)              // sound
    FOFF(6)              // shunting
  ENDIF
  IFLOCO(LOC_3349)
    DELAY(2000)
    FOFF(8)              // sound
    FOFF(6)              // shunting
    FOFF(7)
  ENDIF
  IFLOCO(LOC_3683)
    FOFF(3)
    FOFF(4)
  ENDIF
  IFLOCO(LOC_3000)
  ENDIF
  IFLOCO(LOC_3001)
  ENDIF
  IFLOCO(LOC_3356)
  ENDIF
  IFLOCO(LOC_3005)
  ENDIF
  IFLOCO(LOC_3016)
  ENDIF
  IFLOCO(LOC_3022)
    FOFF(6)              // shunting
  ENDIF
  IFLOCO(LOC_3048_1)
  ENDIF
  IFLOCO(LOC_3048_2)
  ENDIF
  IFLOCO(LOC_3048_CONSIST)
//    SETLOCO(LOC_3048_2)
//    FOFF(0)
//    SETLOCO(LOC_3048_CONSIST)
  ENDIF
  IFLOCO(LOC_3060)
    FOFF(1)
  ENDIF
  IFLOCO(LOC_3089)
  ENDIF
  IFLOCO(LOC_3683)
  ENDIF

  IFLOCO(LOC_3005_COPPER)
  ENDIF

  IFLOCO(LOC_37973)
    FOFF(1)               // sound off
  ENDIF

  IFLOCO(LOC_37994)
    FOFF(8)
  ENDIF

  IFLOCO(LOC_HAG_191)
  ENDIF

RETURN

  
