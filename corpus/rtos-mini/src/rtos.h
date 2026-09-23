/* rtos-mini 样例自带的最小 RTOS 接口。名字借用 CMSIS-RTOS2 / FreeRTOS 的形状，好让引擎的
   profile 规则命中；函数体在 rtos.c 里只是空壳——样例要的是静态形状，不是能跑。 */
#ifndef RTOS_MINI_H
#define RTOS_MINI_H

typedef enum { osPriorityLow = 8, osPriorityNormal = 24, osPriorityHigh = 40 } osPriority_t;
typedef struct { const char *name; unsigned stack_size; osPriority_t priority; } osThreadAttr_t;
typedef void *osThreadId_t;
typedef void *QueueHandle_t;

osThreadId_t osThreadNew(void (*fn)(void *), void *arg, const osThreadAttr_t *attr);
void osDelay(unsigned ticks);

int xTaskCreate(void (*fn)(void *), const char *name, unsigned stack, void *arg, unsigned prio, void **handle);
void vTaskDelay(unsigned ticks);
int xQueueReceive(QueueHandle_t queue, void *out, unsigned ticks_to_wait);
int xQueueSendFromISR(QueueHandle_t queue, const void *item, void *woken);

#define tskIDLE_PRIORITY 0
#define portMAX_DELAY 0xffffffffu

#endif
