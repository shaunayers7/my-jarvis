# my-jarvis
a second brain personal assistant

## Picking prints

- Ask "show me my prints" on the home screen, or open the Picker.
- Suggestions stay centered in one readable column, with space between cards.
- Tap to highlight your picks. Each tap restarts a 3-second pause; unselected
  cards then fade out and your picks glide to the top in their original screen
  order, without crossing. The saved list still remembers your selection order.
- You can also say "done" in the conversation or tap Done in the Picker.
  Typing in the conversation holds the timer so it does not interrupt you.
- Tap a remaining card to choose your first task and save the list.
- Today shows the saved list in one column on phones and adds columns when
  the screen has enough room. Long lists scroll instead of shrinking the text.

## Conversation and motion

- The conversation shows Jarvis's responses only, not copies of your prompts.
- Cards float upward while fading in over 800ms, into a centered column.
  Long suggestion lists scroll inside the card area instead of overflowing.
- Unpicked cards fade out over 500ms; selected cards stay visible and gently
  glide to the top over 900ms. They never fade out and reappear.
- The card area stays steady while the picks move. Jarvis reserves
  space for each response before typing it, so text does not push the screen
  around on every letter.
- The iPhone/iPad Reduce Motion setting disables movement and typing effects.
- Motion follows [Apple's guidance](https://developer.apple.com/design/human-interface-guidelines/motion)
  and [web.dev's animation guidance](https://web.dev/articles/animations-guide).
  No animation libraries or build step are needed.
