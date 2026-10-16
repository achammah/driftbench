# H3 runs re-classified with the rewritten format rule (182 exact-match failures)

Companion to `value_equivalence.md`, section 3c. Classes: R3 tool definition (user value copied verbatim, tool failed, no format stated, agent asked again per prompt line 41); R6 prompt (agent asked for a town the tool does not need, per prompt line 41); R7 agent behaviour (skipped a step the prompt states); R5 pass with the test flagged (tool accepted the value, no format stated). "User wrote" is the run's user message, cut at 70 characters, with dashes replaced by commas. Source: `research/block-redesign/phrasing/data/h1/runs-class.jsonl` on branch `research/block-phrasing`.

| Run | Class | User wrote (slot surface) | Agent sent | Provenance | Tool result | Agent next | At fault |
|---|---|---|---|---|---|---|---|
| B1#11#0 | R3 | My street address is 88 Summit Ave, Acmeville and this is the addre... | `88 Summit Ave, Acmeville` | verbatim | NOT FOUND | asked user again | tool definition; test (single path) |
| B1#12#0 | R3 | Please check availability at 88 Summit Ave, Acmeville I would like ... | `88 Summit Ave, Acmeville` | verbatim | NOT FOUND | asked user again | tool definition; test (single path) |
| B1#13#0 | R3 | Hey, 88 Summit Ave, Acmeville. | `88 Summit Ave, Acmeville` | verbatim | NOT FOUND | asked user again | tool definition; test (single path) |
| B1#17#0 | R3 | Hey, could you check what's available at 88 Summit Ave, Acmeville, ... | `88 Summit Ave, Acmeville` | verbatim | NOT FOUND | asked user again | tool definition; test (single path) |
| B1#2#0 | R3 | Hey, heres my adress: 88 Summit Ave, Acmeville | `88 Summit Ave, Acmeville` | verbatim | NOT FOUND | asked user again | tool definition; test (single path) |
| B1#22#0 | R3 | As requested, the street address is 88 Summit Ave, Acmeville. | `88 Summit Ave, Acmeville` | verbatim | NOT FOUND | asked user again | tool definition; test (single path) |
| B1#23#0 | R3 | Hey my street address is 88 Summit Ave, Acmeville Yep that is the a... | `88 Summit Ave, Acmeville` | verbatim | NOT FOUND | asked user again | tool definition; test (single path) |
| B1#26#0 | R3 | Please use 88 Summit Ave, Acmeville. | `88 Summit Ave, Acmeville` | verbatim | NOT FOUND | asked user again | tool definition; test (single path) |
| B1#3#0 | R3 | Please check availability at 88 Summit Ave, Acmeville. The weather ... | `88 Summit Ave, Acmeville` | verbatim | NOT FOUND | asked user again | tool definition; test (single path) |
| B1#9#0 | R3 | The address is 88 Summit Ave, Acmeville. The weather has been pleas... | `88 Summit Ave, Acmeville` | verbatim | NOT FOUND | asked user again | tool definition; test (single path) |
| B5#0#0 | R3 | Please arrange Fiber 1000 at 14 Harbor Rd, Acmeville for the order ... | `14 Harbor Rd, Acmeville` | verbatim | NOT FOUND | asked user again | tool definition; test (single path) |
| B5#10#0 | R3 | Please arrange a subscription to Fiber 1000 at 14 Harbor Rd, Acmevi... | `14 Harbor Rd, Acmeville` | verbatim | NOT FOUND | asked user again | tool definition; test (single path) |
| B5#11#0 | R3 | Hey, I'd like to order Fiber 1000 for 14 Harbor Rd, Acmeville, at t... | `14 Harbor Rd, Acmeville` | verbatim | NOT FOUND | asked user again | tool definition; test (single path) |
| B5#16#0 | R3 | Please arrange a purchase of Fiber 1000 at 14 Harbor Rd, Acmeville ... | `14 Harbor Rd, Acmeville` | verbatim | NOT FOUND | asked user again | tool definition; test (single path) |
| B5#21#0 | R3 | Kindly process my purchase of Fiber 1000 at 14 Harbor Rd, Acmeville. | `14 Harbor Rd, Acmeville` | verbatim | NOT FOUND | asked user again | tool definition; test (single path) |
| B5#23#0 | R3 | Order Fiber 1000 for 14 Harbor Rd, Acmeville | `14 Harbor Rd, Acmeville` | verbatim | NOT FOUND | asked user again | tool definition; test (single path) |
| B5#4#0 | R3 | Could you please arrange an order for Fiber 1000 at 14 Harbor Rd, A... | `14 Harbor Rd, Acmeville` | verbatim | NOT FOUND | asked user again | tool definition; test (single path) |
| B5#6#0 | R3 | At 14 Harbor Rd, Acmeville, Fiber 1000, plese arange. | `14 Harbor Rd, Acmeville` | verbatim | NOT FOUND | asked user again | tool definition; test (single path) |
| B8#0#0 | R3 | The location is 7 Quarry Ln, Acmeville This is the location for you... | `7 Quarry Ln, Acmeville` | verbatim | NOT FOUND | asked user again | tool definition; test (single path) |
| B8#12#0 | R3 | Hey, with this wierdly sunny day, could you check availabilty at 7 ... | `7 Quarry Ln, Acmeville` | verbatim | NOT FOUND | asked user again | tool definition; test (single path) |
| B8#16#0 | R3 | Hey my address is 7 Quarry Ln, Acmeville | `7 Quarry Ln, Acmeville` | verbatim | NOT FOUND | asked user again | tool definition; test (single path) |
| B8#21#0 | R3 | Hey, here's the locashun: 7 Quarry Ln, Acmeville. That's the same s... | `7 Quarry Ln, Acmeville` | verbatim | NOT FOUND | asked user again | tool definition; test (single path) |
| B8#24#0 | R3 | The address is 7 Quarry Ln, Acmeville, and the weather is pleasant ... | `7 Quarry Ln, Acmeville` | verbatim | NOT FOUND | asked user again | tool definition; test (single path) |
| B8#26#0 | R3 | Could you check 7 Quarry Ln, Acmeville as my address My day has bee... | `7 Quarry Ln, Acmeville` | verbatim | NOT FOUND | asked user again | tool definition; test (single path) |
| B8#29#0 | R3 | Hey, can you check 7 Quarry Ln, Acmeville? | `7 Quarry Ln, Acmeville` | verbatim | NOT FOUND | asked user again | tool definition; test (single path) |
| B8#4#0 | R3 | Plase kindly usee 7 Quarry Ln, Acmeville. | `7 Quarry Ln, Acmeville` | verbatim | NOT FOUND | asked user again | tool definition; test (single path) |
| B8#7#0 | R3 | My adress details read 7 Quarry Ln, Acmeville, while today's skys l... | `7 Quarry Ln, Acmeville` | verbatim | NOT FOUND | asked user again | tool definition; test (single path) |
| B8#9#0 | R3 | The address is 7 Quarry Ln, Acmeville. You asked for the street add... | `7 Quarry Ln, Acmeville` | verbatim | NOT FOUND | asked user again | tool definition; test (single path) |
| B5#13#0 | R6 | Hey, ordr the Fiber 1000 plan for 14 harbor road, plese. | none | no call | no call | asked for town | prompt |
| B5#8#0 | R6 | Hi, I would like to order the Fiber 1000 plan for 14 harbor road, a... | none | no call | no call | asked for town | prompt |
| B6#25#0 | R6 | May I inquire whether residential broadband service is offered for ... | none | no call | no call | asked for town | prompt |
| B3#1#0 | R7 | Would you kindly use (202) 555-0150 as the number I wish to bring t... | `(202) 555-0150` | verbatim | canonicalised to +12025550150 | asked user instead of calling catalog_search | agent |
| B3#10#0 | R7 | Pleese port my numbr: 2025550150. | `2025550150` | verbatim | canonicalised to +12025550150 | asked user instead of calling catalog_search | agent |
| B3#11#0 | R7 | The number I would like to bring to Acme is +1 202 555 0150, which ... | `+1 202 555 0150` | verbatim | canonicalised to +12025550150 | asked user instead of calling catalog_search | agent |
| B3#12#0 | R7 | It's +1 202 555 0150, that's the number I'm bringing over. | `+1 202 555 0150` | verbatim | canonicalised to +12025550150 | asked user instead of calling catalog_search | agent |
| B3#13#0 | R7 | Could ya port 2025550150 over for mee, plese? | `2025550150` | verbatim | canonicalised to +12025550150 | asked user instead of calling catalog_search | agent |
| B3#14#0 | R7 | It is 2025550150 | `2025550150` | verbatim | canonicalised to +12025550150 | asked user instead of calling catalog_search | agent |
| B3#16#0 | R7 | Please use +1 202 555 0150 as the number I bring to Acme. That’s th... | `+1 202 555 0150` | verbatim | canonicalised to +12025550150 | asked user instead of calling catalog_search | agent |
| B3#19#0 | R7 | Please use +1 202 555 0150 for the switch; my mornign has been busyy. | `+1 202 555 0150` | verbatim | canonicalised to +12025550150 | asked user instead of calling catalog_search | agent |
| B3#2#0 | R7 | That's my numbr to bring ovr: +1 202 555 0150. | `+1 202 555 0150` | verbatim | canonicalised to +12025550150 | asked user instead of calling catalog_search | agent |
| B3#20#0 | R7 | My celulr numbr: 2025550150 | `2025550150` | verbatim | canonicalised to +12025550150 | asked user instead of calling catalog_search | agent |
| B3#22#0 | R7 | It's +1 202 555 0150. That's the numbr I'd like to bring over, thnks! | `+1 202 555 0150` | verbatim | canonicalised to +12025550150 | asked user instead of calling catalog_search | agent |
| B3#24#0 | R7 | Hey can ya bring +1 202 555 0150 | `+1 202 555 0150` | verbatim | canonicalised to +12025550150 | asked user instead of calling catalog_search | agent |
| B3#26#0 | R7 | It's 2025550150 | `2025550150` | verbatim | canonicalised to +12025550150 | asked user instead of calling catalog_search | agent |
| B3#27#0 | R7 | That is (202) 555-0150 | `(202) 555-0150` | verbatim | canonicalised to +12025550150 | asked user instead of calling catalog_search | agent |
| B3#29#0 | R7 | My number is +1 202 555 0150 | `+1 202 555 0150` | verbatim | canonicalised to +12025550150 | asked user instead of calling catalog_search | agent |
| B3#4#0 | R7 | The number is 2025550150. That's the same number. | `2025550150` | verbatim | canonicalised to +12025550150 | asked user instead of calling catalog_search | agent |
| B3#5#0 | R7 | Could you bring 2025550150 over to Acme for me Its been a nice day ... | `2025550150` | verbatim | canonicalised to +12025550150 | asked user instead of calling catalog_search | agent |
| B3#6#0 | R7 | Mine’s (202) 555-0150. | `(202) 555-0150` | verbatim | canonicalised to +12025550150 | asked user instead of calling catalog_search | agent |
| B3#7#0 | R7 | For keeping my number with Acme the number is (202) 555-0150 | `(202) 555-0150` | verbatim | canonicalised to +12025550150 | asked user instead of calling catalog_search | agent |
| B5#22#0 | R7 | Hello, I would like to place an order for Fiber 1000 at 14 Harbor R... | none | no call | no call | asked to confirm address | agent |
| B6#16#0 | R7 | Hi can you tell me whether home internet is available at 3 orchard way | `3 Orchard Way` | case only | found | asked user instead of calling catalog_search | agent |
| B6#22#0 | R7 | Could you please confirm whether home internet service is available... | `3 Orchard Way, Acmeville` | verbatim | found | asked user instead of calling catalog_search | agent |
| B6#4#0 | R7 | Please let me know whether 3 orchard way has home internet service.... | `3 Orchard Way` | case only | found | asked user instead of calling catalog_search | agent |
| B9#0#0 | R7 | Mi numbr iz (202) 555-0160. | `(202) 555-0160` | verbatim | canonicalised to +12025550160 | asked user instead of calling catalog_search | agent |
| B9#1#0 | R7 | You can bring this line over: +1 202 555 0160. The weather's lovely... | `+1 202 555 0160` | verbatim | canonicalised to +12025550160 | asked user instead of calling catalog_search | agent |
| B9#10#0 | R7 | Hey, my number is 202-555-0160, and the weather's lovely today. | `202-555-0160` | verbatim | canonicalised to +12025550160 | asked user instead of calling catalog_search | agent |
| B9#11#0 | R7 | Could you bring this number over for me? It’s (202) 555-0160. | `(202) 555-0160` | verbatim | canonicalised to +12025550160 | asked user instead of calling catalog_search | agent |
| B9#15#0 | R7 | My number is 202-555-0160 The weather is pleasant today | `202-555-0160` | verbatim | canonicalised to +12025550160 | asked user instead of calling catalog_search | agent |
| B9#16#0 | R7 | For your records, the line I use remains +1 202 555 0160. | `+1 202 555 0160` | verbatim | canonicalised to +12025550160 | asked user instead of calling catalog_search | agent |
| B9#17#0 | R7 | Hey, can you use +1 202 555 0160 as my numbr to swich over? | `+1 202 555 0160` | verbatim | canonicalised to +12025550160 | asked user instead of calling catalog_search | agent |
| B9#19#0 | R7 | My number is (202) 555-0160, and that's the number. | `(202) 555-0160` | verbatim | canonicalised to +12025550160 | asked user instead of calling catalog_search | agent |
| B9#2#0 | R7 | Could you use 202-555-0160 as my number | `202-555-0160` | verbatim | canonicalised to +12025550160 | asked user instead of calling catalog_search | agent |
| B9#21#0 | R7 | Hey I want to bring +1 202 555 0160 to Acme and keep it I am switch... | `+1 202 555 0160` | verbatim | canonicalised to +12025550160 | asked user instead of calling catalog_search | agent |
| B9#22#0 | R7 | My number is 202-555-0160. | `202-555-0160` | verbatim | canonicalised to +12025550160 | asked user instead of calling catalog_search | agent |
| B9#23#0 | R7 | Hey, could you bring 202-555-0160 over to Acme for me? It’s been a ... | `202-555-0160` | verbatim | canonicalised to +12025550160 | asked user instead of calling catalog_search | agent |
| B9#24#0 | R7 | I would like to share my number, which is (202) 555-0160. I hope yo... | `(202) 555-0160` | verbatim | canonicalised to +12025550160 | asked user instead of calling catalog_search | agent |
| B9#25#0 | R7 | Bring (202) 555-0160 over | `(202) 555-0160` | verbatim | canonicalised to +12025550160 | asked user instead of calling catalog_search | agent |
| B9#27#0 | R7 | Hey, my numbr is (202) 555-0160. That's the number I'm bringing ove... | `(202) 555-0160` | verbatim | canonicalised to +12025550160 | asked user instead of calling catalog_search | agent |
| B9#28#0 | R7 | The number to bring over is +1 202 555 0160, and the weather is ple... | `+1 202 555 0160` | verbatim | canonicalised to +12025550160 | asked user instead of calling catalog_search | agent |
| B9#3#0 | R7 | My number is +1 202 555 0160. I am switching to Acme and brining th... | `+1 202 555 0160` | verbatim | canonicalised to +12025550160 | asked user instead of calling catalog_search | agent |
| B9#5#0 | R7 | For my switch to Acme, the number I would like to bring over is 202... | `202-555-0160` | verbatim | canonicalised to +12025550160 | asked user instead of calling catalog_search | agent |
| B9#6#0 | R7 | My number is +1 202 555 0160 and the weather is lovely today | `+1 202 555 0160` | verbatim | canonicalised to +12025550160 | asked user instead of calling catalog_search | agent |
| B9#7#0 | R7 | Heye, heres this phonne: 202-555-0160 | `202-555-0160` | verbatim | canonicalised to +12025550160 | asked user instead of calling catalog_search | agent |
| B9#8#0 | R7 | Please use +1 202 555 0160. | `+1 202 555 0160` | verbatim | canonicalised to +12025550160 | asked user instead of calling catalog_search | agent |
| B9#9#0 | R7 | For the transfer, please record (202) 555-0160; the weathre has bee... | `(202) 555-0160` | verbatim | canonicalised to +12025550160 | asked user instead of calling catalog_search | agent |
| B1#27#0 | R5 | Please check availability for 88 summit avenue. The weather has bee... | `88 summit avenue` | verbatim | found | n/a | test |
| B1#5#0 | R5 | 88 summit avenue and the weather is nice | `88 summit avenue` | verbatim | found | n/a | test |
| B1#6#0 | R5 | 88 summit avenue | `88 summit avenue` | verbatim | found | n/a | test |
| B2#0#0 | R5 | Hey, here's my phne number: 202.555.0131, thnks! | `202.555.0131` | verbatim | lead queued | n/a | test |
| B2#1#0 | R5 | You can reach me at +1 202 555 0131; the weather is lovely today. | `+1 202 555 0131` | verbatim | lead queued | n/a | test |
| B2#10#0 | R5 | Hey, you can reach me at +1 202 555 0131. The weathr's been lovely ... | `+1 202 555 0131` | verbatim | lead queued | n/a | test |
| B2#12#0 | R5 | Please have the sales advisor call me at (202) 555-0131 and the wea... | `(202) 555-0131` | verbatim | lead queued | n/a | test |
| B2#14#0 | R5 | You can reach me at (202) 555-0131 Thanks | `(202) 555-0131` | verbatim | lead queued | n/a | test |
| B2#15#0 | R5 | Please use my contcat numbr, +1 202 555 0131, for the callback. | `+1 202 555 0131` | verbatim | lead queued | n/a | test |
| B2#16#0 | R5 | My phone number is +1 202 555 0131 for the call back | `+1 202 555 0131` | verbatim | lead queued | n/a | test |
| B2#17#0 | R5 | Please use 202.555.0131 as the number for the sales advisor to call... | `202.555.0131` | verbatim | lead queued | n/a | test |
| B2#18#0 | R5 | Please use (202) 555-0131 as my phone number. | `(202) 555-0131` | verbatim | lead queued | n/a | test |
| B2#19#0 | R5 | Please contact me at 202.555.0131. The weather is quite pleasent to... | `202.555.0131` | verbatim | lead queued | n/a | test |
| B2#20#0 | R5 | +1 202 555 0131 is best. | `+1 202 555 0131` | verbatim | lead queued | n/a | test |
| B2#21#0 | R5 | Use (202) 555-0131 for the callback; the weathr is lovley today. | `(202) 555-0131` | verbatim | lead queued | n/a | test |
| B2#22#0 | R5 | Hey call me back at (202) 555-0131 That is my callback number | `(202) 555-0131` | verbatim | lead queued | n/a | test |
| B2#23#0 | R5 | Please use (202) 555-0131 for the callback. That’s the number to re... | `(202) 555-0131` | verbatim | lead queued | n/a | test |
| B2#24#0 | R5 | Please use +1 202 555 0131 for the callback Thank you | `+1 202 555 0131` | verbatim | lead queued | n/a | test |
| B2#25#0 | R5 | Yeh, cal me at (202) 555-0131 | `(202) 555-0131` | verbatim | lead queued | n/a | test |
| B2#26#0 | R5 | Use 202.555.0131, please, it's sunny out today. | `202.555.0131` | verbatim | lead queued | n/a | test |
| B2#27#0 | R5 | Hey, can you setp that call back to +1 202 555 0131, since it’s for... | `+1 202 555 0131` | verbatim | lead queued | n/a | test |
| B2#28#0 | R5 | You can call 202.555.0131 | `202.555.0131` | verbatim | lead queued | n/a | test |
| B2#29#0 | R5 | Kindly pleese cal +1 202 555 0131. | `+1 202 555 0131` | verbatim | lead queued | n/a | test |
| B2#3#0 | R5 | Call me at +1 202 555 0131 | `+1 202 555 0131` | verbatim | lead queued | n/a | test |
| B2#4#0 | R5 | You can reach me at 202.555.0131 The weather is nice today | `202.555.0131` | verbatim | lead queued | n/a | test |
| B2#5#0 | R5 | Please use 202.555.0131. | `202.555.0131` | verbatim | lead queued | n/a | test |
| B2#6#0 | R5 | Hey use (202) 555-0131 for the advisor to call me back for that cal... | `(202) 555-0131` | verbatim | lead queued | n/a | test |
| B2#7#0 | R5 | The phone number is +1 202 555 0131. This is the phone number I pro... | `+1 202 555 0131` | verbatim | lead queued | n/a | test |
| B2#8#0 | R5 | Heres my numbr: (202) 555-0131 | `(202) 555-0131` | verbatim | lead queued | n/a | test |
| B2#9#0 | R5 | Please have the advisor call me at (202) 555-0131; it's a lovely da... | `(202) 555-0131` | verbatim | lead queued | n/a | test |
| B3#17#0 | R5 | That is (202) 555-0150, and the weather is mild today. | `(202) 555-0150` | verbatim | canonicalised to +12025550150 | n/a | test |
| B3#23#0 | R5 | It is 2025550150 and the weather is nice | `2025550150` | verbatim | canonicalised to +12025550150 | n/a | test |
| B3#25#0 | R5 | Hey, could you bring this number over to Acme: (202) 555-0150? The ... | `(202) 555-0150` | verbatim | canonicalised to +12025550150 | n/a | test |
| B3#28#0 | R5 | Hey, my number's (202) 555-0150, and the weathre's reely nice today. | `(202) 555-0150` | verbatim | canonicalised to +12025550150 | n/a | test |
| B3#9#0 | R5 | The number I would like to bring is +1 202 555 0150 The weather is ... | `+1 202 555 0150` | verbatim | canonicalised to +12025550150 | n/a | test |
| B4#10#0 | R5 | The email for my Acme account is Sam.Rivera@example.com, which is m... | `Sam.Rivera@example.com` | verbatim | customer found | n/a | test |
| B4#11#0 | R5 | Hey my email is Sam.Rivera@example.com | `Sam.Rivera@example.com` | verbatim | customer found | n/a | test |
| B4#14#0 | R5 | My account email address is SAM.RIVERA@EXAMPLE.COM. The weather is ... | `SAM.RIVERA@EXAMPLE.COM` | verbatim | customer found | n/a | test |
| B4#15#0 | R5 | The email address associated with my Acme account is SAM.RIVERA@EXA... | `SAM.RIVERA@EXAMPLE.COM` | verbatim | customer found | n/a | test |
| B4#17#0 | R5 | My email is Sam.Rivera@example.com The weather feels pleasant today | `Sam.Rivera@example.com` | verbatim | customer found | n/a | test |
| B4#19#0 | R5 | It's Sam.Rivera@example.com, and the weathr's lovely, hope your day'... | `Sam.Rivera@example.com` | verbatim | customer found | n/a | test |
| B4#2#0 | R5 | It's Sam.Rivera@example.com. Hope that helps. | `Sam.Rivera@example.com` | verbatim | customer found | n/a | test |
| B4#20#0 | R5 | You can find my account under Sam.Rivera@example.com. That should b... | `Sam.Rivera@example.com` | verbatim | customer found | n/a | test |
| B4#21#0 | R5 | Hey, my account email is SAM.RIVERA@EXAMPLE.COM. That’s the address... | `SAM.RIVERA@EXAMPLE.COM` | verbatim | customer found | n/a | test |
| B4#24#0 | R5 | Please use Sam.Rivera@example.com as the email address associated w... | `Sam.Rivera@example.com` | verbatim | customer found | n/a | test |
| B4#27#0 | R5 | My acount email is SAM.RIVERA@EXAMPLE.COM, pleas. | `SAM.RIVERA@EXAMPLE.COM` | verbatim | customer found | n/a | test |
| B4#28#0 | R5 | Hey, my email's Sam.Rivera@example.com. | `Sam.Rivera@example.com` | verbatim | customer found | n/a | test |
| B4#4#0 | R5 | Hey, my Acme account email is SAM.RIVERA@EXAMPLE.COM, the same emai... | `SAM.RIVERA@EXAMPLE.COM` | verbatim | customer found | n/a | test |
| B4#5#0 | R5 | The email address on my account is Sam.Rivera@example.com, and the ... | `Sam.Rivera@example.com` | verbatim | customer found | n/a | test |
| B4#6#0 | R5 | Account email: SAM.RIVERA@EXAMPLE.COM | `SAM.RIVERA@EXAMPLE.COM` | verbatim | customer found | n/a | test |
| B4#9#0 | R5 | It is SAM.RIVERA@EXAMPLE.COM The email address on my Acme account i... | `SAM.RIVERA@EXAMPLE.COM` | verbatim | customer found | n/a | test |
| B7#0#0 | R5 | Please have the sales advisor call me at +1 202 555 0188. | `+1 202 555 0188` | verbatim | lead queued | n/a | test |
| B7#1#0 | R5 | Hey use 202 555 0188 for the callback That is my phone number for t... | `202 555 0188` | verbatim | lead queued | n/a | test |
| B7#10#0 | R5 | Hey have them call me at +1 202 555 0188 and the weather feels grea... | `+1 202 555 0188` | verbatim | lead queued | n/a | test |
| B7#11#0 | R5 | Please use (202) 555-0188 to reach me I would appreciate the callback | `(202) 555-0188` | verbatim | lead queued | n/a | test |
| B7#12#0 | R5 | For the callback, the advisor can reach me at +1 202 555 0188. That... | `+1 202 555 0188` | verbatim | lead queued | n/a | test |
| B7#13#0 | R5 | Hey, it's 202 555 0188 | `+1 202 555 0188` | agent-derived (+1 added) | lead queued | n/a | test |
| B7#14#0 | R5 | Use (202) 555-0188 as my phone number and that is the number to cal... | `(202) 555-0188` | verbatim | lead queued | n/a | test |
| B7#15#0 | R5 | You can reach me at +1 202 555 0188. The sunshine's lovely today. | `+1 202 555 0188` | verbatim | lead queued | n/a | test |
| B7#16#0 | R5 | My numbr is 202 555 0188. A callbak can reach me there. | `202 555 0188` | verbatim | lead queued | n/a | test |
| B7#17#0 | R5 | Could ya have the advizor call me at 202 555 0188 to check coverage... | `202 555 0188` | verbatim | lead queued | n/a | test |
| B7#18#0 | R5 | Please use (202) 555-0188 for the callback. The weather has been pl... | `(202) 555-0188` | verbatim | lead queued | n/a | test |
| B7#19#0 | R5 | Please use +1 202 555 0188 as my contakt numbr. | `+1 202 555 0188` | verbatim | lead queued | n/a | test |
| B7#2#0 | R5 | The number for the advisor is (202) 555-0188. My mornig has been ca... | `(202) 555-0188` | verbatim | lead queued | n/a | test |
| B7#20#0 | R5 | Please call me at (202) 555-0188. | `(202) 555-0188` | verbatim | lead queued | n/a | test |
| B7#21#0 | R5 | The requested phone number is +1 202 555 0188 and that is the numbe... | `+1 202 555 0188` | verbatim | lead queued | n/a | test |
| B7#22#0 | R5 | The weather is lovely today Please have the sales advisor call me a... | `202 555 0188` | verbatim | lead queued | n/a | test |
| B7#23#0 | R5 | Please use 202 555 0188 as my phone number. This is the number for ... | `202 555 0188` | verbatim | lead queued | n/a | test |
| B7#24#0 | R5 | Here's my numbr, calbak: +1 202 555 0188 | `+1 202 555 0188` | verbatim | lead queued | n/a | test |
| B7#25#0 | R5 | Please have the sales adivsor call me at (202) 555-0188, as I would... | `(202) 555-0188` | verbatim | lead queued | n/a | test |
| B7#26#0 | R5 | Hey just give me a ring at 202 555 0188 | `202 555 0188` | verbatim | lead queued | n/a | test |
| B7#27#0 | R5 | Please use +1 202 555 0188 | `+1 202 555 0188` | verbatim | lead queued | n/a | test |
| B7#28#0 | R5 | Hey, use +1 202 555 0188 for the callback. It's a sunny afternon he... | `+1 202 555 0188` | verbatim | lead queued | n/a | test |
| B7#29#0 | R5 | Pleese use ths: (202) 555-0188 | `(202) 555-0188` | verbatim | lead queued | n/a | test |
| B7#3#0 | R5 | Call me on +1 202 555 0188 | `+1 202 555 0188` | verbatim | lead queued | n/a | test |
| B7#4#0 | R5 | The appropriate callback number is 202 555 0188; the weathre has be... | `202 555 0188` | verbatim | lead queued | n/a | test |
| B7#5#0 | R5 | Hey, use (202) 555-0188 for the callback, that’s the number to call ... | `(202) 555-0188` | verbatim | lead queued | n/a | test |
| B7#6#0 | R5 | Hey, my numbr, pleez: (202) 555-0188 | `(202) 555-0188` | verbatim | lead queued | n/a | test |
| B7#7#0 | R5 | The phone number is 202 555 0188, and the weather is pleasant today. | `202 555 0188` | verbatim | lead queued | n/a | test |
| B7#8#0 | R5 | The phone number for the sales advisor is +1 202 555 0188. This is ... | `+1 202 555 0188` | verbatim | lead queued | n/a | test |
| B7#9#0 | R5 | Please call me at 202 555 0188 | `202 555 0188` | verbatim | lead queued | n/a | test |
| B8#1#0 | R5 | The address is 7 quarry lane, hey, that's the adress you asked me f... | `7 Quarry Lane` | case only | found | n/a | test |
| B8#10#0 | R5 | The location is 7 quarry lane. | `7 Quarry Lane` | case only | found | n/a | test |
| B8#14#0 | R5 | The address is 7 quarry lane. I hope your afternon is going well; t... | `7 quarry lane` | verbatim | found | n/a | test |
| B8#19#0 | R5 | Hey, chek availabilty at 7 quarry lane | `7 Quarry Lane` | case only | found | n/a | test |
| B8#25#0 | R5 | Please use 7 quarry lane as the address I would appreciate your che... | `7 quarry lane` | verbatim | found | n/a | test |
| B8#28#0 | R5 | Residense iz 7 quarry lane | `7 Quarry Lane` | case only | found | n/a | test |
| B8#3#0 | R5 | Please use 7 quarry lane as the address. The weather is mild today. | `7 quarry lane` | verbatim | found | n/a | test |
| B8#6#0 | R5 | My address 7 quarry lane | `7 Quarry Lane` | case only | found | n/a | test |
| B10#0#0 | R5 | My account email is Morgan.Diaz@example.com. Pretty nice weather to... | `Morgan.Diaz@example.com` | verbatim | customer found | n/a | test |
| B10#11#0 | R5 | Please use MORGAN.DIAZ@EXAMPLE.COM. | `MORGAN.DIAZ@EXAMPLE.COM` | verbatim | customer found | n/a | test |
| B10#12#0 | R5 | My Acme account is registered to Morgan.Diaz@example.com. Please us... | `Morgan.Diaz@example.com` | verbatim | customer found | n/a | test |
| B10#13#0 | R5 | Its Morgan.Diaz@example.com This is my email address | `Morgan.Diaz@example.com` | verbatim | customer found | n/a | test |
| B10#14#0 | R5 | Please use Morgan.Diaz@example.com for my account; the wheather is ... | `Morgan.Diaz@example.com` | verbatim | customer found | n/a | test |
| B10#16#0 | R5 | The email address for my Acme account is MORGAN.DIAZ@EXAMPLE.COM Th... | `MORGAN.DIAZ@EXAMPLE.COM` | verbatim | customer found | n/a | test |
| B10#17#0 | R5 | It's the emial: MORGAN.DIAZ@EXAMPLE.COM. Thnks! | `MORGAN.DIAZ@EXAMPLE.COM` | verbatim | customer found | n/a | test |
| B10#2#0 | R5 | Hey, the emial on my Acme accout is MORGAN.DIAZ@EXAMPLE.COM, and th... | `MORGAN.DIAZ@EXAMPLE.COM` | verbatim | customer found | n/a | test |
| B10#20#0 | R5 | The email address on my account is MORGAN.DIAZ@EXAMPLE.COM, and the... | `MORGAN.DIAZ@EXAMPLE.COM` | verbatim | customer found | n/a | test |
| B10#22#0 | R5 | Thats Morgan.Diaz@example.com and thats my email address | `Morgan.Diaz@example.com` | verbatim | customer found | n/a | test |
| B10#26#0 | R5 | Thats my emial: MORGAN.DIAZ@EXAMPLE.COM | `MORGAN.DIAZ@EXAMPLE.COM` | verbatim | customer found | n/a | test |
| B10#27#0 | R5 | Hey please use MORGAN.DIAZ@EXAMPLE.COM for my account My day is goi... | `MORGAN.DIAZ@EXAMPLE.COM` | verbatim | customer found | n/a | test |
| B10#4#0 | R5 | The email for my account is MORGAN.DIAZ@EXAMPLE.COM | `MORGAN.DIAZ@EXAMPLE.COM` | verbatim | customer found | n/a | test |
| B10#5#0 | R5 | My custmer emale is Morgan.Diaz@example.com. | `Morgan.Diaz@example.com` | verbatim | customer found | n/a | test |
| B10#6#0 | R5 | It is Morgan.Diaz@example.com, and it is my email address. | `Morgan.Diaz@example.com` | verbatim | customer found | n/a | test |
| B10#7#0 | R5 | It's MORGAN.DIAZ@EXAMPLE.COM. My mornign has been busy, and the wea... | `MORGAN.DIAZ@EXAMPLE.COM` | verbatim | customer found | n/a | test |
| B10#8#0 | R5 | Here ya go Morgan.Diaz@example.com | `Morgan.Diaz@example.com` | verbatim | customer found | n/a | test |
