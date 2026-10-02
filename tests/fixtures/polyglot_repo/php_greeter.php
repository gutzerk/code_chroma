<?php

/**
 * Greets people by name.
 */
class Greeter
{
    /**
     * Builds the greeting for a name.
     */
    public function hello($name)
    {
        return "hi " . $name;
    }

    private function helper()
    {
        return "unused";
    }
}
