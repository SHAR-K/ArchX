#include "led.h"
#include "heartbeat.h"

extern void scheduler_add(void (*task)(void));
extern void scheduler_run(void);

int main(void)
{
    led_init();
    scheduler_add(led_task);
    scheduler_add(heartbeat_task);
    scheduler_run();
    return 0;
}
