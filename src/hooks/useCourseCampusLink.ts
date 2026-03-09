import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface CourseOption {
  id: string;
  name: string;
  code: string;
  duration_years: number;
  department_id: string;
  department_name: string;
  institution_id: string;
  institution_name: string;
  campus_id: string;
  campus_name: string;
}

export interface CampusOption {
  id: string;
  name: string;
}

/**
 * Fetches courses with their full hierarchy (course → department → institution → campus)
 * and provides campus filtering based on selected course.
 */
export function useCourseCampusLink() {
  const [courseOptions, setCourseOptions] = useState<CourseOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      // Join courses → departments → institutions → campuses
      const { data, error } = await supabase
        .from("courses")
        .select(`
          id, name, code, duration_years, department_id,
          departments!inner (
            id, name, institution_id,
            institutions!inner (
              id, name, campus_id,
              campuses!inner ( id, name )
            )
          )
        `)
        .order("name");

      if (error) {
        console.error("useCourseCampusLink fetch error:", error);
        setLoading(false);
        return;
      }

      const options: CourseOption[] = (data || []).map((c: any) => ({
        id: c.id,
        name: c.name,
        code: c.code,
        duration_years: c.duration_years,
        department_id: c.departments.id,
        department_name: c.departments.name,
        institution_id: c.departments.institutions.id,
        institution_name: c.departments.institutions.name,
        campus_id: c.departments.institutions.campuses.id,
        campus_name: c.departments.institutions.campuses.name,
      }));

      setCourseOptions(options);
      setLoading(false);
    };

    fetchData();
  }, []);

  /** All unique campuses */
  const allCampuses = useMemo<CampusOption[]>(() => {
    const map = new Map<string, string>();
    courseOptions.forEach((c) => map.set(c.campus_id, c.campus_name));
    return Array.from(map, ([id, name]) => ({ id, name }));
  }, [courseOptions]);

  /** Get campuses available for a given course_id */
  const getCampusesForCourse = (courseId: string | null): CampusOption[] => {
    if (!courseId) return allCampuses;
    const match = courseOptions.find((c) => c.id === courseId);
    if (!match) return allCampuses;
    // A course belongs to exactly one campus via the hierarchy,
    // but the same course name could exist across multiple campuses/departments
    const campusIds = new Set<string>();
    const result: CampusOption[] = [];
    courseOptions
      .filter((c) => c.id === courseId || c.name === match.name)
      .forEach((c) => {
        if (!campusIds.has(c.campus_id)) {
          campusIds.add(c.campus_id);
          result.push({ id: c.campus_id, name: c.campus_name });
        }
      });
    // For a specific course_id, return only that course's campus
    return [{ id: match.campus_id, name: match.campus_name }];
  };

  /** Grouped courses by department for optgroup display */
  const coursesByDepartment = useMemo(() => {
    const map = new Map<string, { department: string; courses: { id: string; name: string }[] }>();
    courseOptions.forEach((c) => {
      const key = `${c.campus_name} — ${c.department_name}`;
      if (!map.has(key)) {
        map.set(key, { department: key, courses: [] });
      }
      map.get(key)!.courses.push({ id: c.id, name: c.name });
    });
    return Array.from(map.values());
  }, [courseOptions]);

  return {
    courseOptions,
    allCampuses,
    coursesByDepartment,
    getCampusesForCourse,
    loading,
  };
}
