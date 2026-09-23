; blinky 样例的向量表。引擎从这里认中断入口，不按名字猜。
__Vectors       DCD     __initial_sp
                DCD     Reset_Handler
                DCD     0
                DCD     0
                DCD     0
                DCD     0
                DCD     0
                DCD     0
                DCD     0
                DCD     0
                DCD     0
                DCD     0
                DCD     0
                DCD     0
                DCD     0
                DCD     SysTick_Handler
                DCD     BUTTON_IRQHandler
__Vectors_End
                AREA    |.text|, CODE, READONLY
Reset_Handler   PROC
                ENDP
