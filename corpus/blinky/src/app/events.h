#ifndef EVENTS_H
#define EVENTS_H
extern volatile unsigned char g_button_pressed;
extern volatile unsigned g_tick_ms;
void events_wait_button(void);
#endif
