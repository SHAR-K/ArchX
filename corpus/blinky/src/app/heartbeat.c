#include "heartbeat.h"
/* 一个带延时的周期任务：for(;;) 里做一点事然后 scheduler_sleep(50)。
   引擎从「无限循环 + delay 类阻塞调用」推出周期 = 50 × tick，节拍图靠它才有节奏可画；
   led_task 没有延时，是「周期未知」那一类，两种形状样例里都要有。
   s_beats 只有这个任务碰，不进任何共享变量的统计。 */
extern void scheduler_sleep(unsigned ms);

static unsigned s_beats;

void heartbeat_task(void)
{
    for (;;)
    {
        s_beats++;
        scheduler_sleep(50);
    }
}

unsigned heartbeat_count(void) { return s_beats; }
